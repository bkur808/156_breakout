import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter';

function RoomPage() {
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
        let hasJoinedRoom = false; // Prevent duplicate joins

        const validateAndJoinRoom = async () => {
            console.log(`Joining room with ID: ${roomId}`);
            const storedPasscode = localStorage.getItem(`passcode-${roomId}`) || '';

            try {
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
                socket.on('seat-updated', (newParticipants) => {
                    setParticipants((prev) => {
                        if (JSON.stringify(prev) !== JSON.stringify(newParticipants)) return newParticipants;
                        return prev;
                    });
                });
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
        const isInstructor = socket.id === instructorId;
    
        // Create a peer connection
        createPeerConnection(userId, true);
    
        // If instructor, ensure their video stream is shared
        if (isInstructor && localStreamRef.current) {
            const pc = peerConnections.current[userId];
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current);
            });
        }
    
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
        if (peerConnections.current[userId]) return;

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { url: 'turn:192.168.56.1:3478', username: 'Ola', credential: 'CSci156P' }],
        });

        peerConnections.current[userId] = pc;

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
        }

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

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { roomId, userId, candidate: event.candidate });
            }
        };

        if (createOffer) {
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('signal', { roomId, userId, offer: pc.localDescription });
                });
        }
    };

    const addSignalMessageToChat = (data) => {
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

            <div className="top-container">
                <div className="main-video">
                    <h2>Instructor</h2>
                    <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
                    <p>{instructorId ? `Instructor ID: ${instructorId}` : "Loading..."}</p>
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
                            <video ref={(el) => el && (el.srcObject = participant.stream)} className="video-feed" autoPlay playsInline />
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
