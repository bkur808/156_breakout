import './App.css';
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000'); // Connect to the signaling server

function App() {
  const [message, setMessage] = useState('');
  const [inClassroom, setInClassroom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const videoRef = useRef(null);

  // Function to fetch message and set up video when in the classroom
  useEffect(() => {
    if (inClassroom) {
      // Fetch message from backend API
      fetch('http://localhost:5000/api/message')
        .then(response => response.json())
        .then(data => setMessage(data.message));

      // Request access to the webcam
      navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }

          // Notify the server to join the specified room
          socket.emit('join-room', roomId);

          // Listen for events when other users join the room
          socket.on('user-joined', (userId) => {
            console.log(`User joined room: ${userId}`);
            // Additional logic for establishing connections with the new user can go here
          });

          // Listen for WebRTC signaling messages
          socket.on('signal', ({ signalData, senderId }) => {
            console.log('Received signal from:', senderId, signalData);
            // Handle WebRTC signaling data here (e.g., create offers/answers, add ICE candidates)
          });
        })
        .catch((error) => console.error("Error accessing webcam:", error));
    }
  }, [inClassroom, roomId]);

  // Handle Room ID input
  const handleRoomIdChange = (event) => {
    setRoomId(event.target.value);
  };

  // Generate a random Room ID
  const generateRandomId = () => {
    const randomId = Math.random().toString(36).substr(2, 9);
    setRoomId(randomId);
  };

  // Enter the classroom with the current Room ID
  const enterClassroom = () => {
    if (roomId) {
      setInClassroom(true);
    } else {
      alert("Please enter or generate a Room ID.");
    }
  };

  return (
    <div className="App">
      {inClassroom ? (
        // Classroom view with video and classroom ID display
        <div>
          <h1>156 Breakout Video Chat App</h1>
          <h2>Classroom ID: {roomId}</h2>
          <p>{message}</p>
          {/* Video element for displaying webcam feed */}
          <video ref={videoRef} autoPlay playsInline style={{ width: "500px", height: "auto", border: "2px solid black" }} />
        </div>
      ) : (
        // Entry screen with Room ID input and buttons
        <div>
          <h1>Enter Classroom</h1>
          <input
            type="text"
            value={roomId}
            onChange={handleRoomIdChange}
            placeholder="Enter Room ID or Generate One"
            style={{
              textAlign: "center",
              padding: "10px",
              fontSize: "16px",
              marginBottom: "20px",
              width: "60%"
            }}
          />
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "10px" }}>
            <button
              onClick={enterClassroom}
              style={{ padding: "10px 20px", fontSize: "16px" }}
            >
              Create Room ID
            </button>
            <button
              onClick={generateRandomId}
              style={{ padding: "10px 20px", fontSize: "16px" }}
            >
              Random ID
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
