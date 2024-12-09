import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter'; // used for compatability between different browsers

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState(Array(10).fill(null)); // Initialize 10 empty seats
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    useEffect(() => {
        console.log(`Joining room with ID: ${roomId}`);
    
        // Attempt to retrieve passcode only if stored (assumed for instructor)
        const storedPasscode = localStorage.getItem(`passcode-${roomId}`);
    
        let isInstructor = false; // Track if the current user is the instructor
    
        // Fetch room details to validate the room
        fetch(`/api/validate-room?roomId=${roomId}&passcode=${storedPasscode || ''}`)
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to fetch room details (status: ${response.status})`);
                return response.json();
            })
            .then((data) => {
                isInstructor = socket.id === data.instructorId; // Compare socket ID to instructorId
    
                // If the user is the instructor, allow stored passcode
                const passcodeToSend = isInstructor ? storedPasscode : null;
    
                // Join room via Socket.IO
                socket.emit('join-room', { roomId, passcode: passcodeToSend });
    
                // Get local media stream
                return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            })
            .then((stream) => {
                localStreamRef.current = stream;
    
                // Display local video stream
                const localVideo = localVideoRef.current;
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.onloadedmetadata = () => localVideo.play().catch(console.error);
                }
    
                // Listen for updates
                socket.on('seat-updated', (updatedParticipants) => {
                    console.log('Updated participants:', updatedParticipants);
                    setParticipants(updatedParticipants);
                });
    
                socket.on('signal', handleSignal);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);
            })
            .catch((err) => {
                console.error('Error initializing room:', err.message);
                alert('Failed to initialize room. Redirecting to homepage.');
                window.location.href = '/';
            });
    
        // Cleanup function
        return () => {
            console.log('Cleaning up resources...');
            Object.values(peerConnections.current).forEach((pc) => pc.close());
            socket.emit('leave-room', { roomId });
            socket.off('seat-updated');
            socket.off('signal');
            socket.off('user-connected');
            socket.off('user-disconnected');
        };
    }, [roomId, socket]);
    
    

    const handleUserConnected = (userId) => {
        console.log(`User connected: ${userId}`);
        createPeerConnection(userId, true);
    };

    const handleUserDisconnected = (userId) => {
        console.log(`User disconnected: ${userId}`);
        if (peerConnections.current[userId]) {
            peerConnections.current[userId].onicecandidate = null;
            peerConnections.current[userId].ontrack = null;
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }
        setParticipants((prev) => {
            const updated = { ...prev };
            delete updated[userId];

            return updated;
        });
    };

    const iceCandidateQueue = {};

    const handleSignal = async ({ userId, offer, answer, candidate }) => {
        const pc = peerConnections.current[userId];
    
        if (!pc) {
            // Queue ICE candidates if the peer connection isn't ready
            iceCandidateQueue[userId] = iceCandidateQueue[userId] || [];
            iceCandidateQueue[userId].push(candidate);
            return;
        }
    
        if (offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { roomId, userId, answer: pc.localDescription });
        } else if (answer) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } else if (candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    
        // Process queued candidates if any
        if (iceCandidateQueue[userId]) {
            iceCandidateQueue[userId].forEach(async (queuedCandidate) => {
                await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate));
            });
            delete iceCandidateQueue[userId];
        }
        pc.onconnectionstatechange = () => console.log(`Connection state: ${pc.connectionState}`);
        pc.oniceconnectionstatechange = () => console.log(`ICE connection state: ${pc.iceConnectionState}`);

    };
    
    const createPeerConnection = (userId, createOffer) => {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                {
                    urls: 'turn:192.168.56.1:3478',
                    username: 'Ola',
                    credential: 'CSci156P',
                },
            ],
        });
        
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
    
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { roomId, userId, candidate: event.candidate });
            }
        };
    
        // Handle remote stream tracks
        pc.ontrack = (event) => {
            console.log(`Received track from ${userId}`, event.streams);
    
            setParticipants((prev) => {
                const updated = [...prev];
                const seatIndex = updated.findIndex((seat) => seat === null);
    
                if (seatIndex !== -1 && event.streams[0]) {
                    updated[seatIndex] = event.streams[0]; // Set the MediaStream
                }
                return updated;
            });
        };
    
        if (createOffer) {
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('signal', { roomId, userId, offer: pc.localDescription });
                });
        }
    
        peerConnections.current[userId] = pc;
    };
    

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            <div className="main-video">
                <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
            </div>
            <div className="seat-grid">
                {participants.map((participant, index) => (
                    <div key={index} className="seat-box">
                        {/* Check if participant is a MediaStream */}
                        {participant instanceof MediaStream ? (
                            <video
                                ref={(el) => {
                                    if (el && participant) el.srcObject = participant;
                                }}
                                className="video-feed"
                                autoPlay
                                playsInline
                            />
                        ) : participant ? (
                            // If participant is connected but stream not ready
                            <div className="connected-seat">
                                User {participant} is connecting...
                            </div>
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
