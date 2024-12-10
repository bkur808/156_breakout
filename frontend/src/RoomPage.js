import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter';

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState(Array(10).fill(null));
    const [instructorId, setInstructorId] = useState(null);
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    // Chat box state
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
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                socket.on('seat-updated', setParticipants);
                socket.on('signal', handleSignal);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);
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
        };
    }, [roomId, socket]);

    const handleSignal = (signal) => {
        setChatMessages((prev) => [...prev, { text: `Signal: ${JSON.stringify(signal)}`, sender: "System" }]);
    };

    const handleSendMessage = () => {
        if (message.trim()) {
            setChatMessages((prev) => [...prev, { text: message, sender: "You" }]);
            setMessage("");
        }
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            <div className="top-container">
                {/* Instructor Video */}
                <div className="main-video">
                    <h2>Instructor</h2>
                    <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
                </div>

                {/* Chat Box */}
                <div className="chat-box">
                    <h2>Chat</h2>
                    <div className="chat-messages">
                        {chatMessages.map((msg, index) => (
                            <div
                                key={index}
                                className={`chat-message ${msg.sender === "You" ? "sent" : "received"}`}
                            >
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

            {/* Participant Grid */}
            <div className="seat-grid">
                {participants.map((participant, index) => (
                    <div key={index} className="seat-box">
                        {participant ? (
                            <video
                                ref={(el) => el && (el.srcObject = participant)}
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
