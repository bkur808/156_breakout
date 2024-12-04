import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { SocketContext } from './App';

function HomePage() {
    const [roomId, setRoomId] = useState('');
    const [passcode, setPasscode] = useState('');
    const [isProtected, setIsProtected] = useState(false);
    const navigate = useNavigate();
    const socket = useContext(SocketContext);

    const createRoom = () => {
        if (!roomId) {
            alert('Please enter a Room ID or generate one.');
            return;
        }

        const payload = {
            roomId,
            passcode: isProtected ? passcode : null,
            isProtected,
            instructorId: socket.id,
        };

        fetch('http://localhost:5000/api/create-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then((response) => {
                if (!response.ok) {
                    return response.json().then((error) => {
                        throw new Error(error.error);
                    });
                }
                return response.json();
            })
            .then(() => {
                if (isProtected) {
                    localStorage.setItem(`passcode-${roomId}`, passcode);
                }
                navigate(`/${roomId}`);
            })
            .catch((err) => alert(`Error creating room: ${err.message}`));
    };

    const joinRoom = () => {
        if (!roomId) {
            alert('Please enter a Room ID to join.');
            return;
        }

        fetch(`http://localhost:5000/api/validate-room?roomId=${roomId}&passcode=${passcode}`)
            .then((response) => {
                if (!response.ok) {
                    return response.json().then((error) => {
                        throw new Error(error.error);
                    });
                }
                if (passcode) {
                    localStorage.setItem(`passcode-${roomId}`, passcode);
                }
                navigate(`/${roomId}`);
            })
            .catch((err) => alert(`Error joining room: ${err.message}`));
    };

    const generateRandomId = () => {
        const randomId = Math.random().toString(36).substr(2, 9);
        setRoomId(randomId);
    };

    return (
        <div className="homepage">
            <h1 className="homepage-title">Welcome to the Video App</h1>
            <div className="homepage-input-group">
                <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Enter Room ID or Generate One"
                    className="homepage-input"
                />
                <button onClick={generateRandomId} className="homepage-button">
                    Generate ID
                </button>
            </div>
            <div className="homepage-input-group">
                <input
                    type="text"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Enter Passcode (Optional)"
                    className="homepage-input"
                />
                <label className="homepage-label">
                    <input
                        type="checkbox"
                        checked={isProtected}
                        onChange={() => setIsProtected(!isProtected)}
                        className="homepage-checkbox"
                    />
                    Protect Room with Passcode
                </label>
            </div>
            <div className="homepage-button-group">
                <button onClick={createRoom} className="homepage-button">
                    Create Room
                </button>
                <button onClick={joinRoom} className="homepage-button">
                    Join Room
                </button>
            </div>
        </div>
    );
}

export default HomePage;