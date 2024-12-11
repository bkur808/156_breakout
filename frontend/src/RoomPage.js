import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import { ThemeContext } from './ThemeContext';
import 'webrtc-adapter';

function RoomPage() {
    const { toggleTheme } = useContext(ThemeContext);
    const { roomId } = useParams();
    const socket = useContext(SocketContext);

    const [participants, setParticipants] = useState(Array(8).fill(null));
    const [instructorId, setInstructorId] = useState(null);
    const [mySocketId, setMySocketId] = useState(null);

    const localVideoRef = useRef(null);
    const localStreamRef = useRef(null);
    const peerConnections = useRef({});
    const [chatMessages, setChatMessages] = useState([]);
    const [message, setMessage] = useState("");

    useEffect(() => {
        let hasJoinedRoom = false; // Prevents duplicate joins

        const validateAndJoinRoom = async () => {
            console.log(`Joining room with ID: ${roomId}`);
            const storedPasscode = localStorage.getItem(`passcode-${roomId}`) || '';

            try {
                // Room validation
                const response = await fetch(`/api/validate-room?roomId=${roomId}&passcode=${storedPasscode}`);
                if (!response.ok) throw new Error('Room validation failed');
                const data = await response.json();

                setInstructorId(data.instructorId);

                // Emit join-room only once
                if (!hasJoinedRoom) {
                    socket.emit('join-room', { roomId, passcode: storedPasscode });
                    setMySocketId(socket.id);
                    hasJoinedRoom = true;
                }

                // Access user's media stream
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;

                // If instructor, display their stream in the main video
                if (socket.id === data.instructorId && localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                // Socket event listeners
                socket.on('seat-updated', setParticipants);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);
                socket.on('signal', handleSignal);
                socket.on('signal-message', addSignalMessageToChat);
                socket.on('room-closed', handleRoomClosed);
            } catch (err) {
                console.error('Error:', err.message);
                window.location.href = '/';
            }
        };

        validateAndJoinRoom();

        return () => {
            // Cleanup connections and listeners
            Object.values(peerConnections.current).forEach((pc) => pc.close());
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            socket.emit('leave-room', { roomId });
            socket.off('seat-updated');
            socket.off('user-connected');
            socket.off('user-disconnected');
            socket.off('signal');
            socket.off('signal-message');
            socket.off('room-closed');
        };
    }, [roomId, socket]);

    const handleUserConnected = (userId) => {
        console.log(`User connected: ${userId}`);
        createPeerConnection(userId, true);
        addSignalMessageToChat({ sender: "System", text: `User ${userId} connected.` });
    };

    const handleUserDisconnected = (userId) => {
        console.log(`User disconnected: ${userId}`);
        if (peerConnections.current[userId]) {
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }
        setParticipants((prev) => prev.map((p) => (p?.id === userId ? null : p)));
        addSignalMessageToChat({ sender: "System", text: `User ${userId} disconnected.` });
    };

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
    };

    const createPeerConnection = (userId, createOffer) => {
        if (peerConnections.current[userId]) return; // Prevent duplicate connections

        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerConnections.current[userId] = pc;

        // Add local tracks to the peer connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current);
            });
        }

        // Handle remote tracks and update participant grid
        pc.ontrack = (event) => {
            console.log(`Received track from user ${userId}`);
            setParticipants((prev) => {
                const updated = [...prev];
                const seatIndex = updated.findIndex((seat) => seat === null);
                if (seatIndex !== -1) {
                    updated[seatIndex] = { id: userId, stream: event.streams[0] };
                }
                return updated;
            });
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { roomId, userId, candidate: event.candidate });
            }
        };

        // If initiating the connection, create and send an offer
        if (createOffer) {
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('signal', { roomId, userId, offer: pc.localDescription });
                });
        }
    };

    const addSignalMessageToChat = (data) => {
        // Avoid displaying messages sent by the current user's socket ID
        if (data.sender !== socket.id) {
            setChatMessages((prev) => [...prev, { sender: data.sender, text: data.text }]);
        }
    };

    const handleRoomClosed = () => {
        addSignalMessageToChat({ sender: "System", text: "The room has been closed by the instructor." });
        alert("Room closed by instructor. Redirecting to homepage.");
        window.location.href = '/';
    };

    const handleSendMessage = () => {
        if (message.trim()) {
            socket.emit('signal-message', message);
            setChatMessages((prev) => [...prev, { sender: "You", text: message }]);
            setMessage("");
        }
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            {mySocketId === instructorId && (
                <button onClick={handleRoomClosed}>Close Room</button>
            )}
            <button onClick={toggleTheme}>Toggle Theme</button>
            <div className="top-container">
                <div className="main-video">
                    <h2>Instructor</h2>
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
                            <video
                                ref={(el) => el && (el.srcObject = participant.stream)}
                                className="video-feed"
                                autoPlay
                                playsInline
                            />
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
