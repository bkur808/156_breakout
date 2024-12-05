import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState(Array(10).fill(null)); // Initialize with 10 empty seats
    const [roomDetails, setRoomDetails] = useState(null);
    const [role, setRole] = useState(null); // Store the user's role
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    // Base URL dynamically detected
    const baseUrl = window.location.origin;

    useEffect(() => {
        // Fetch room details using the current URL
        fetch(`${baseUrl}/${roomId}`)
            .then((response) => {
                if (!response.ok) throw new Error('Failed to fetch room details');
                return response.json();
            })
            .then((details) => {
                setRoomDetails(details);

                // Access camera and microphone
                return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            })
            .then((stream) => {
                localStreamRef.current = stream;

                const localVideo = localVideoRef.current;
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.onloadedmetadata = () => localVideo.play().catch(console.error);
                }

                // Join the room via Socket.IO
                socket.emit('join-room', { roomId });

                // Listen for role assignment
                socket.on('role-assigned', ({ role }) => {
                    setRole(role);
                    console.log(`You are assigned the role: ${role}`);
                });

                // Handle seat updates
                socket.on('seat-updated', (updatedParticipants) => {
                    setParticipants(updatedParticipants);
                });

                // WebRTC signaling
                socket.on('signal', handleSignal);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);
            })
            .catch((err) => {
                console.error('Error fetching room details or accessing media devices:', err.message);
                alert('Failed to initialize room. Redirecting to homepage.');
                window.location.href = '/';
            });

        // Cleanup on unmount
        return () => {
            Object.values(peerConnections.current).forEach((pc) => pc.close());
            socket.emit('leave-room', { roomId });
        };
    }, [roomId, socket, baseUrl]);

    const handleUserConnected = (userId) => {
        console.log(`User connected: ${userId}`);
        createPeerConnection(userId, true);
    };

    const handleUserDisconnected = (userId) => {
        console.log(`User disconnected: ${userId}`);
        if (peerConnections.current[userId]) {
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }

        setParticipants((prev) => {
            const updated = [...prev];
            const seatIndex = updated.findIndex((seat) => seat === userId);
            if (seatIndex !== -1) updated[seatIndex] = null;
            return updated;
        });
    };

    const handleSignal = async ({ userId, offer, answer, candidate }) => {
        const pc = peerConnections.current[userId];
        if (!pc) return;

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
    };

    const createPeerConnection = (userId, createOffer) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        // Add local stream tracks to the peer connection
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { roomId, userId, candidate: event.candidate });
            }
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
                .then(() => {
                    socket.emit('signal', { roomId, userId, offer: pc.localDescription });
                });
        }

        peerConnections.current[userId] = pc;
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>
            {roomDetails && (
                <p>
                    {role === 'instructor'
                        ? 'You are the instructor. Main video feed is active.'
                        : `Instructor: ${roomDetails.instructorId}`}
                </p>
            )}
            <div className="main-video">
                <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
            </div>
            <div className="seat-grid">
                {participants.map((stream, index) => (
                    <div key={index} className="seat-box">
                        {stream ? (
                            <video
                                ref={(el) => {
                                    if (el) el.srcObject = stream;
                                }}
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
