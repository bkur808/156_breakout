import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState({});
    const [roomDetails, setRoomDetails] = useState(null);
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
                navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                    .then((stream) => {
                        localStreamRef.current = stream;

                        const localVideo = localVideoRef.current;
                        if (localVideo) {
                            localVideo.srcObject = stream;
                            localVideo.onloadedmetadata = () => {
                                localVideo.play().catch((err) => {
                                    console.error('Error playing video:', err);
                                });
                            };
                        }

                        // Check if the current user is the instructor
                        if (details.instructorId === socket.id) {
                            console.log('You are the instructor. Main video feed is active.');
                        }

                        // Join the room via Socket.IO
                        socket.emit('join-room', { roomId });
                    })
                    .catch((err) => {
                        console.error('Error accessing media devices:', err);
                        alert('Failed to access camera and microphone.');
                    });

            })
            .catch((err) => {
                console.error('Error fetching room details:', err.message);
                alert('Failed to fetch room details. Redirecting to homepage.');
                window.location.href = '/';
            });

        // WebSocket listeners for signaling
        socket.on('signal', handleSignal);
        socket.on('user-connected', handleUserConnected);
        socket.on('user-disconnected', handleUserDisconnected);

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
        if (participants[userId]) {
            setParticipants((prev) => {
                const updated = { ...prev };
                delete updated[userId];
                return updated;
            });
        }
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
            setParticipants((prev) => ({
                ...prev,
                [userId]: event.streams[0],
            }));
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
                    {roomDetails.instructorId === socket.id
                        ? 'You are the instructor. Main video feed is active.'
                        : `Instructor: ${roomDetails.instructorId}`}
                </p>
            )}
            <div className="main-video">
                <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
            </div>
            <div className="seat-grid">
                {Object.entries(participants).map(([userId, stream], index) => (
                    <div key={userId} className="seat-box">
                        <video
                            ref={(el) => {
                                if (el) el.srcObject = stream;
                            }}
                            className="video-feed"
                            autoPlay
                            playsInline
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default RoomPage;
