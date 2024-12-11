import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from './App';
import 'webrtc-adapter';

function RoomPage() {
    const { roomId } = useParams();
    const socket = useContext(SocketContext);
    const [participants, setParticipants] = useState([]); // Array to hold participant video streams
    const [instructorId, setInstructorId] = useState(null);
    const localVideoRef = useRef(null);
    const peerConnections = useRef({});
    const localStreamRef = useRef(null);

    useEffect(() => {
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

                // Instructor's stream in the main video feed
                if (localVideoRef.current) localVideoRef.current.srcObject = stream;

                socket.on('seat-updated', handleSeatUpdated);
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

    const handleSeatUpdated = (updatedParticipants) => {
        setParticipants(updatedParticipants);
    };

    const handleUserConnected = (userId) => {
        createPeerConnection(userId, true);
    };

    const handleUserDisconnected = (userId) => {
        if (peerConnections.current[userId]) {
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
        }
        setParticipants((prev) => prev.filter((p) => p.id !== userId));
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
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerConnections.current[userId] = pc;

        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

        pc.ontrack = (event) => {
            setParticipants((prev) => [...prev, { id: userId, stream: event.streams[0] }]);
        };

        if (createOffer) {
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => socket.emit('signal', { roomId, userId, offer: pc.localDescription }));
        }
    };

    return (
        <div className="room-page">
            <h1>Room ID: {roomId}</h1>

            {/* Main Video Feed for Instructor */}
            <div className="main-video">
                <h2>Instructor</h2>
                <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
            </div>

            {/* Seat Grid for Participants */}
            <div className="seat-grid">
                {participants.map((participant, index) => (
                    <div key={participant.id || index} className="seat-box">
                        <h3>Participant {index + 1}</h3>
                        <video
                            ref={(el) => el && (el.srcObject = participant.stream)}
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
