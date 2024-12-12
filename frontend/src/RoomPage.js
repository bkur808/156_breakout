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

    const handleInstructorConnected = async () => {
        console.log('Instructor connected');
    
        try {
            // Ensure local stream is obtained
            if (!localStreamRef.current) {
                console.log("Requesting instructor's media stream...");
                localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                console.log("Instructor's media stream obtained:", localStreamRef.current);
            }
    
            // Create self peer connection
            createPeerConnection(socket.id, false);
    
            // Add tracks to self peer connection
            const pc = peerConnections.current[socket.id];
            if (pc && localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    console.log(`Adding track (${track.kind}) to peer connection for instructor.`);
                    pc.addTrack(track, localStreamRef.current);
                });
            } else {
                console.error("Peer connection or local stream not available for instructor!");
            }
        } catch (err) {
            console.error("Error accessing media devices for instructor:", err);
            alert("You need to allow access to your camera and microphone to continue.");
        }
    };
    
    
    const handleUserConnected = async (userId) => {
        console.log(`User connected: ${userId}`);
    
        // Ensure local stream is available
        if (!localStreamRef.current) {
            localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
    
        createPeerConnection(userId, true);
    
        const pc = peerConnections.current[userId];
        if (pc && localStreamRef.current) {
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
        console.log(`Signal received from ${userId}:`, { offer, answer, candidate });
    
        // Check if a peer connection already exists
        let pc = peerConnections.current[userId];
        if (!pc) {
            console.warn(`No peer connection found for ${userId}. Creating one...`);
            pc = createPeerConnection(userId, false); // Ensure connection exists
        }
    
        // Handle Offer
        if (offer) {
            console.log(`Received SDP Offer from ${userId}. Setting remote description...`);
            pc.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => {
                    console.log("Remote description set. Creating SDP Answer...");
                    return pc.createAnswer();
                })
                .then((answer) => {
                    console.log("SDP Answer created:", answer);
                    return pc.setLocalDescription(answer);
                })
                .then(() => {
                    console.log("Sending SDP Answer back to signaling server...");
                    // Send answer back to the backend to relay it to the participant
                    socket.emit('signal', { roomId, userId, answer: pc.localDescription });
                })
                .catch((err) => {
                    console.error("Error handling SDP Offer:", err);
                });
        }
        // Handle Answer
        else if (answer) {
            console.log(`Received SDP Answer from ${userId}. Setting remote description...`);
            pc.setRemoteDescription(new RTCSessionDescription(answer))
                .then(() => {
                    console.log("Remote description set with Answer.");
                })
                .catch((err) => {
                    console.error("Error setting SDP Answer:", err);
                });
        }
        // Handle ICE Candidate
        else if (candidate) {
            console.log(`Received ICE Candidate from ${userId}. Adding to PeerConnection...`);
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .then(() => {
                    console.log("ICE Candidate added successfully.");
                })
                .catch((err) => {
                    console.error("Error adding ICE Candidate:", err);
                });
        }
    };
    
    const createPeerConnection = (userId, createOffer) => {
        if (peerConnections.current[userId]) return;

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { url: 'turn:192.168.56.1:3478', username: 'Ola', credential: 'CSci156P' }],
        });

        peerConnections.current[userId] = pc;

        pc.ontrack = (event) => {
            console.log(`ontrack triggered: Received track(s) from user ${userId}`);
            console.log("Event streams:", event.streams);
        
            setParticipants((prev) => {
                const updated = [...prev];
                const seatIndex = updated.findIndex((seat) => seat === null);
                if (seatIndex !== -1) {
                    console.log(`Adding stream to participants at seat ${seatIndex}.`);
                    updated[seatIndex] = { id: userId, stream: event.streams[0] };
                } else {
                    console.warn("No available seat to add the incoming stream!");
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
                .then((offer) => {
                    console.log("SDP Offer created:", offer);
                    return pc.setLocalDescription(offer);
                })
                .then(() => {
                    console.log("Sending SDP Offer to signaling server...");
                    socket.emit('signal', { roomId, offer: pc.localDescription }); // Only send roomId and offer
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
