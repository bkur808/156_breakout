import "./App.css";
import React, { createContext } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import HomePage from "./HomePage"; // Main page for room creation
import RoomPage from "./RoomPage"; // Dynamic room page
import { io } from "socket.io-client";
import { ThemeProvider } from "./ThemeContext";

// Socket Context for global use
export const SocketContext = createContext();

// Dynamically set the socket server URL
const socket = io(
  process.env.NODE_ENV === "production"
    ? "" // For production, same origin as backend
    : "http://localhost:5000" // Development URL
);

function App() {
  return (
    <ThemeProvider>
      <SocketContext.Provider value={socket}>
        <Router>
          <Routes>
            {/* HomePage for creating rooms */}
            <Route path="/" element={<HomePage />} />

            {/* RoomPage for handling specific rooms */}
            <Route path="/:roomId" element={<RoomPage />} />
          </Routes>
        </Router>
      </SocketContext.Provider>
    </ThemeProvider>
  );
}

export default App;
