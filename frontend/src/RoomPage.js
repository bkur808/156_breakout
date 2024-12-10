import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter'; // used for compatability between different browsers

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState(Array(10).fill(null)); // 10 seats
    const [instructorId, setInstructorId] = useState(null); // Store instructor's socket ID
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    useEffect(() => {
        console.log(`Joining room with ID: ${roomId}`);
        const storedPasscode = localStorage.getItem(`passcode-${roomId}`);
        let isInstructor = false;

        fetch(`/api/validate-room?roomId=${roomId}&passcode=${storedPasscode || ''}`)
            .then((response) => response.json())
            .then((data) => {
                setInstructorId(data.instructorId); // Save instructor ID
                isInstructor = socket.id === data.instructorId;

                // Join room
                socket.emit('join-room', { roomId, passcode: isInstructor ? storedPasscode : null });

                return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            })
            .then((stream) => {
                localStreamRef.current = stream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                socket.on('seat-updated', (updatedParticipants) => {
                    setParticipants(updatedParticipants);
                });

                socket.on('signal', handleSignal);
                socket.on('user-connected', handleUserConnected);
                socket.on('user-disconnected', handleUserDisconnected);
            })
            .catch((err) => {
                console.error('Error:', err.message);
                alert('Failed to join room.');
                window.location.href = '/';
            });

        return () => {
            Object.values(peerConnections.current).forEach((pc) => pc.close());
            socket.emit('leave-room', { roomId });
            socket.off('seat-updated');
            socket.off('signal');
            socket.off('user-connected');
            socket.off('user-disconnected');
        };
    }, [roomId, socket]);

    const handleUserConnected = (userId) => createPeerConnection(userId, true);

    const handleUserDisconnected = (userId) => {
        if (peerConnections.current[userId]) {
            peerConnections.current[userId].onicecandidate = null;
            peerConnections.current[userId].ontrack = null;
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }

        setParticipants((prev) => prev.map((seat) => (seat === userId ? null : seat)));

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

            {/* Instructor's Video */}
            <div className="main-video">
                {socket.id === instructorId ? (
                    <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
                ) : (
                    participants.map(
                        (participant, index) =>
                            participant?.socketId === instructorId && (
                                <video
                                    key={index}
                                    ref={(el) => el && (el.srcObject = participant)}
                                    className="video-feed"
                                    autoPlay
                                    playsInline
                                />
                            )
                    )
                )}
            </div>

            {/* Seat Grid for Students */}
            <div className="seat-grid">
                {participants.map((participant, index) => {
                    if (participant?.socketId === instructorId) return null; // Skip instructor

                    return (
                        <div key={index} className="seat-box">
                            {participant instanceof MediaStream ? (
                                <video
                                    ref={(el) => el && (el.srcObject = participant)}
                                    className="video-feed"
                                    autoPlay
                                    playsInline
                                />
                            ) : participant ? (
                                <div className="connected-seat">User is connecting...</div>
                            ) : (
                                <div className="empty-seat">Seat {index + 1}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default RoomPage;
