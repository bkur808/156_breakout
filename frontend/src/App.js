import './App.css';
import React, { useEffect, useRef, useState } from 'react';

function App() {
  const [message, setMessage] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
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
  }, []);

  return (
    <div>
      <h1>156 Breakout Video Chat App</h1>
      <p>{message}</p>
      
      {/* Video element for displaying webcam feed */}
      <video ref={videoRef} autoPlay playsInline style={{ width: "500px", height: "auto", border: "2px solid black" }} />
    </div>
  );
}

export default App;
