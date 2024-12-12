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

    const localStreamRef = useRef(null);
    const peerConnections = useRef({});
    const [chatMessages, setChatMessages] = useState([]);
    const [message, setMessage] = useState("");

    const mainVideoStream = useRef(null); // Holds instructor's stream

    useEffect(() => {
        let hasJoinedRoom = false;

        const fetchRoomDetailsAndJoin = async () => {
            console.log(`Fetching room details for ID: ${roomId}`);
            try {
                const response = await fetch(`/fetch-room-data/${roomId}`);
                if (!response.ok) throw new Error('Failed to fetch room details');
                const data = await response.json();

                console.log('Room details fetched:', data);
                setInstructorId(data.instructorId);

                if (!hasJoinedRoom) {
                    socket.emit('join-room', { roomId });
                    setMySocketId(socket.id);
                    hasJoinedRoom = true;
                }

                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;

                if (socket.id === data.instructorId) {
                    handleInstructorConnected();
                } else {
                    handleUserConnected(socket.id, stream);
                }

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

        fetchRoomDetailsAndJoin();

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

    const handleInstructorConnected = () => {
        console.log('Instructor connected');
        mainVideoStream.current = localStreamRef.current;
    };

    const shareInstructorStream = () => {
        Object.keys(peerConnections.current).forEach((userId) => {
            const pc = peerConnections.current[userId];
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    pc.addTrack(track, localStreamRef.current);
                });
            }
        });
    };

    const handleUserConnected = (userId, stream = null) => {
        console.log(`User connected: ${userId}`);
        createPeerConnection(userId, true);

        if (stream) {
            const pc = peerConnections.current[userId];
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        }
        shareInstructorStream();

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

    const handleKeyPress = (e) => {
        if (e.key === "Enter") {
            handleSendMessage();
        }
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            {mySocketId === instructorId && (
                <button onClick={handleRoomClosed}>Close Room</button>
            )}
            <button onClick={toggleTheme} className='roompage-button'>Toggle Dark Mode</button>
            <div className="top-container">
                <div className="main-video">
                    <video
                        className="video-feed"
                        autoPlay
                        playsInline
                        muted={socket.id === instructorId} // Mute only on instructor's side
                        ref={(el) => {
                            if (el) {
                                // If the current user is the instructor, display the local stream
                                if (socket.id === instructorId && localStreamRef.current) {
                                    el.srcObject = localStreamRef.current;
                                } 
                                // If not, display the instructor's main video stream
                                else if (mainVideoStream.current) {
                                    el.srcObject = mainVideoStream.current;
                                }
                            }
                        }}
                    />
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
                            onKeyPress={handleKeyPress}
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
                                className="video-feed"
                                autoPlay
                                playsInline
                                ref={(el) => el && (el.srcObject = participant.stream)}
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
