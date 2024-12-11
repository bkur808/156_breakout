import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter';

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState(Array(8).fill(null));
    const [instructorId, setInstructorId] = useState(null);
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    // Chat State
    const [chatMessages, setChatMessages] = useState([]);
    const [message, setMessage] = useState("");

    useEffect(() => {
        console.log(`Joining room with ID: ${roomId}`);
        const storedPasscode = localStorage.getItem(`passcode-${roomId}`);

        fetch(`/api/validate-room?roomId=${roomId}&passcode=${storedPasscode || ''}`)
            .then((response) => response.json())
            .then((data) => {
                setInstructorId(data.instructorId);
                socket.emit('join-room', { roomId });

                return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            })
            .then((stream) => {
                localStreamRef.current = stream;
                if (localVideoRef.current) localVideoRef.current.srcObject = stream;

                socket.on('seat-updated', setParticipants);
                socket.on('signal', handleSignal);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);

                // Log signal messages into the chat
                socket.on('signal-message', (signalMsg) => {
                    addSignalMessageToChat(signalMsg);
                });

                socket.on('room-closed', () => {
                    addSignalMessageToChat("The room has been closed by the instructor.");
                    alert("Room closed by instructor. Redirecting to homepage.");
                    window.location.href = '/';
                });
            })
            .catch((err) => {
                console.error('Error:', err.message);
                window.location.href = '/';
            });

        return () => {
            Object.values(peerConnections.current).forEach((pc) => pc.close());
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            socket.emit('leave-room', { roomId });
            socket.off('seat-updated');
            socket.off('signal');
            socket.off('user-connected');
            socket.off('user-disconnected');
            socket.off('room-closed');
        };
    }, [roomId, socket]);

    const handleSignal = ({ userId, offer, answer, candidate }) => {
        const pc = peerConnections.current[userId];
        if (!pc) return;

        if (offer) {
            pc.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => pc.createAnswer())
                .then((answer) => {
                    pc.setLocalDescription(answer);
                    socket.emit('signal', { roomId, userId, answer: pc.localDescription });
                });
        } else if (answer) {
            pc.setRemoteDescription(new RTCSessionDescription(answer));
        } else if (candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate));
        }

        addSignalMessageToChat(`Signal received from user ${userId}`);
    };

    const handleUserConnected = (userId) => {
        createPeerConnection(userId, true);
        addSignalMessageToChat(`User ${userId} connected.`);
    };

    const closeRoom = async () => {
        try {
            const response = await fetch('/api/delete-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId }),
            });

            if (response.ok) {
                console.log('Room closed successfully.');
                socket.emit('room-closed', { message: 'The room has been closed by the instructor.' });
            } else {
                console.error('Failed to close the room:', response.statusText);
            }
        } catch (error) {
            console.error('Error closing the room:', error);
        }
    };

    const handleUserDisconnected = (userId) => {
        if (userId === instructorId) {
            console.log("Instructor disconnected. Closing the room.");
            closeRoom();
        } else {
            if (peerConnections.current[userId]) {
                peerConnections.current[userId].close();
                delete peerConnections.current[userId];
            }
            setParticipants((prev) => prev.map((seat) => (seat === userId ? null : seat)));
            addSignalMessageToChat(`User ${userId} disconnected.`);
        }
    };

    const createPeerConnection = (userId, createOffer) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

        pc.onicecandidate = (event) => {
            if (event.candidate) socket.emit('signal', { roomId, userId, candidate: event.candidate });
        };

        pc.ontrack = (event) => {
            setParticipants((prev) => {
                const updated = [...prev];
                const seatIndex = updated.findIndex((seat) => seat === null);
                if (seatIndex !== -1) updated[seatIndex] = event.streams[0];
                return updated;
            });
        };

        if (createOffer) {
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => socket.emit('signal', { roomId, userId, offer: pc.localDescription }));
        }

        peerConnections.current[userId] = pc;
    };

    const addSignalMessageToChat = (signalMsg) => {
        setChatMessages((prev) => [...prev, { sender: "System", text: signalMsg }]);
    };

    const handleSendMessage = () => {
        if (message.trim()) {
            setChatMessages((prev) => [...prev, { sender: "You", text: message }]);
            setMessage("");
        }
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            <button onClick={closeRoom} style={{ display: instructorId === socket.id ? 'block' : 'none' }}>
                Close Room
            </button>
            <div className="top-container">
                <div className="main-video">
                    <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
                </div>
                <div className="chat-box">
                    <h2>Chat</h2>
                    <div className="chat-messages">
                        {chatMessages.map((msg, index) => (
                            <div key={index} className={`chat-message ${msg.sender === "You" ? "sent" : "received"}`}>
                                <strong>{msg.sender}:</strong> {msg.text}
                            </div>
                        ))}
                    </div>
                    <div className="chat-input">
                        <input
                            type="text"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Type a message..."
                        />
                        <button onClick={handleSendMessage}>Send</button>
                    </div>
                </div>
            </div>

            <div className="seat-grid">
                {participants.map((participant, index) => (
                    <div key={index} className="seat-box">
                        {participant ? (
                            <video ref={(el) => el && (el.srcObject = participant)} className="video-feed" autoPlay playsInline />
                        ) : (
                            <div className="empty-seat">Seat {index + 1}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default RoomPage;
