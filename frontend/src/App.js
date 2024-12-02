import './App.css';
import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import HomePage from './HomePage'; // Main page for room creation
import RoomPage from './RoomPage'; // Dynamic room page
import { createContext } from 'react';
import { io } from 'socket.io-client';

export const SocketContext = createContext();

const socket = io('http://localhost:5000');

function App() {
    return (
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
    );
}

export default App;
