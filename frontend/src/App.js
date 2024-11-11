import './App.css';
import React, { useEffect, useRef, useState } from 'react';

function App() {
  const [message, setMessage] = useState('');
  const [inClassroom, setInClassroom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const videoRef = useRef(null);

  // Fetch message and video setup in the classroom view
  useEffect(() => {
    if (inClassroom) {
      // Fetching message from backend API
      fetch('http://localhost:5000/api/message')
        .then(response => response.json())
        .then(data => setMessage(data.message));

      // Requesting access to the webcam
      navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
          // Setting the video element's source to the webcam stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((error) => {
          console.error("Error accessing webcam:", error);
        });
    }
  }, [inClassroom]);

  // Handle room ID input
  const handleRoomIdChange = (event) => {
    setRoomId(event.target.value);
  };

  // Generate a random room ID
  const generateRandomId = () => {
    const randomId = Math.random().toString(36).substr(2, 9); // Generates a random alphanumeric string
    setRoomId(randomId);
  };

  // Enter the classroom with the current room ID
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
