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

    const localStreamRef = useRef(null);
    const peerConnections = useRef({});
    const [chatMessages, setChatMessages] = useState([]);
    const [message, setMessage] = useState("");

    const mainVideoStream = useRef(null); // Holds instructor's stream

    useEffect(() => {
        let hasJoinedRoom = false;
        console.log(`useEffect triggered. Room ID: ${roomId}`);

        const validateAndJoinRoom = async () => {
            console.log(`Validating room with ID: ${roomId}`);
            const storedPasscode = localStorage.getItem(`passcode-${roomId}`) || '';
            console.log(`Stored passcode: ${storedPasscode}`);

            try {
                console.log('Sending room validation request...');
                const response = await fetch(`/api/validate-room?roomId=${roomId}&passcode=${storedPasscode}`);
                console.log(`Response status: ${response.status}`);
                if (!response.ok) throw new Error('Room validation failed');

                const data = await response.json();
                console.log('Room validation successful:', data);

                setInstructorId(data.instructorId);

                if (!hasJoinedRoom) {
                    console.log('Emitting "join-room" event...');
                    socket.emit('join-room', { roomId, passcode: storedPasscode });
                    setMySocketId(socket.id);
                    hasJoinedRoom = true;
                }

                console.log('Requesting user media...');
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                console.log('User media stream obtained:', stream);

                localStreamRef.current = stream;

                if (socket.id === data.instructorId) {
                    console.log('User is instructor. Connecting instructor...');
                    handleInstructorConnected();
                } else {
                    console.log('User is participant. Connecting user...');
                    handleUserConnected(socket.id, stream);
                }

                console.log('Setting up socket listeners...');
                socket.on('seat-updated', (data) => {
                    console.log('Received "seat-updated" event:', data);
                    setParticipants(data);
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
            console.log('Cleaning up resources...');
            Object.values(peerConnections.current).forEach((pc) => {
                console.log('Closing peer connection:', pc);
                pc.close();
            });
            if (localStreamRef.current) {
                console.log('Stopping local media tracks...');
                localStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            console.log('Emitting "leave-room" event...');
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
        shareInstructorStream();
    };

    const shareInstructorStream = () => {
        console.log('Sharing instructor stream...');
        Object.keys(peerConnections.current).forEach((userId) => {
            const pc = peerConnections.current[userId];
            console.log(`Sharing stream with user: ${userId}`);
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    console.log('Adding track to peer connection:', track);
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
            console.log(`Adding stream tracks for user ${userId}`);
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        }

        addSignalMessageToChat({ sender: "System", text: `User ${userId} connected.` });
    };

    const handleUserDisconnected = (userId) => {
        console.log(`User disconnected: ${userId}`);
        if (peerConnections.current[userId]) {
            console.log(`Closing peer connection for user ${userId}`);
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }
        setParticipants((prev) => prev.map((p) => (p?.id === userId ? null : p)));
        addSignalMessageToChat({ sender: "System", text: `User ${userId} disconnected.` });
    };

    const handleSignal = ({ userId, offer, answer, candidate }) => {
        console.log('Signal received:', { userId, offer, answer, candidate });
        const pc = peerConnections.current[userId];
        if (!pc) return;

        if (offer) {
            console.log('Received offer, creating answer...');
            pc.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => pc.createAnswer())
                .then((answer) => {
                    console.log('Sending answer...');
                    pc.setLocalDescription(answer);
                    socket.emit('signal', { roomId, userId, answer: pc.localDescription });
                });
        } else if (answer) {
            console.log('Received answer, setting remote description...');
            pc.setRemoteDescription(new RTCSessionDescription(answer));
        } else if (candidate) {
            console.log('Adding ICE candidate:', candidate);
            pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    };

    const addSignalMessageToChat = (data) => {
        console.log('Chat message received:', data);
        if (data.sender !== socket.id) {
            setChatMessages((prev) => [...prev, { sender: data.sender, text: data.text }]);
        }
    };

    const handleRoomClosed = () => {
        console.log('Room closed by instructor');
        addSignalMessageToChat({ sender: "System", text: "The room has been closed by the instructor." });
        alert("Room closed by instructor. Redirecting to homepage.");
        window.location.href = '/';
    };

    const handleSendMessage = () => {
        console.log('Sending chat message:', message);
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

            <div className="top-container">
                <div className="main-video">
                    <h2>Instructor</h2>
                    <video
                        className="video-feed"
                        autoPlay
                        playsInline
                        muted={socket.id === instructorId}
                        ref={(el) => {
                            if (el) {
                                if (socket.id === instructorId && localStreamRef.current) {
                                    el.srcObject = localStreamRef.current;
                                } else if (mainVideoStream.current) {
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
