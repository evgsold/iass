import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import api from '../api';

const Layout = ({ children, onCreateClick }) => {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    // Fetch projects for sidebar navigation
    const fetchProjects = async () => {
        try {
            const response = await api.get('/projects');
            setProjects(response.data);
        } catch (error) {
            console.error('Failed to fetch projects for sidebar');
        }
    };
    fetchProjects();
  }, []);

  return (
    <div className="app-layout">
      <Sidebar projects={projects} />
      <div className="main-content-wrapper">
        <TopBar onCreateClick={onCreateClick} />
        <div className="page-content-scrollable">
            {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;