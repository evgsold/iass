import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';

const TerminalComponent = ({ vmId }) => {
    const terminalRef = useRef(null);
    const socketRef = useRef(null);
    const xtermRef = useRef(null);

    useEffect(() => {
        // Initialize xterm
        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#1e1e1e',
                foreground: '#ffffff',
            },
            rows: 24,
            cols: 80
        });
        
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();
        
        xtermRef.current = term;

        // Connect to socket
        const token = localStorage.getItem('token');
        const socket = io('http://localhost:5001', {
            auth: { token },
            query: { token }
        });
        
        socketRef.current = socket;

        socket.on('connect', () => {
            term.write('\r\n*** Connected to terminal server ***\r\n');
            socket.emit('attach-terminal', vmId);
        });

        socket.on('data', (data) => {
            term.write(data);
        });

        socket.on('error', (message) => {
            term.write(`\r\n\x1b[31mError: ${message}\x1b[0m\r\n`);
        });

        socket.on('disconnect', () => {
            term.write('\r\n*** Disconnected from terminal server ***\r\n');
        });

        term.onData((data) => {
            socket.emit('data', data);
        });
        
        term.onResize((size) => {
            socket.emit('resize', size);
        });

        // Handle window resize
        const handleResize = () => {
            fitAddon.fit();
            socket.emit('resize', { cols: term.cols, rows: term.rows });
        };
        
        window.addEventListener('resize', handleResize);

        return () => {
            socket.disconnect();
            term.dispose();
            window.removeEventListener('resize', handleResize);
        };
    }, [vmId]);

    return (
        <div 
            ref={terminalRef} 
            style={{ 
                width: '100%', 
                height: '400px', 
                backgroundColor: '#1e1e1e',
                padding: '10px',
                borderRadius: '4px'
            }} 
        />
    );
};

export default TerminalComponent;