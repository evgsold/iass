import React, { useState, useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Folder, Server, Settings, LogOut, Box, Grid, Database, Layout } from 'lucide-react';

const Sidebar = ({ projects }) => {
  const location = useLocation();
  const { id: projectId } = useParams(); // Get projectId from URL if present

  // Find current project if in project context
  const currentProject = projectId ? projects.find(p => p.id === projectId) : null;

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">
            <Box size={24} color="white" />
        </div>
        <span className="brand-name">IaaS Platform</span>
      </div>

      <div className="sidebar-nav">
        {/* Project Context Navigation */}
        {currentProject ? (
            <div className="nav-section">
                <div className="nav-project-header" style={{ padding: '0 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '24px', height: '24px', background: '#374151', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}>
                        {currentProject.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'white', fontWeight: '600', fontSize: '0.95rem' }}>
                        {currentProject.name}
                    </div>
                </div>

                <Link to={`/projects/${projectId}`} className={`nav-item ${location.pathname === `/projects/${projectId}` ? 'active' : ''}`}>
                    <Grid size={18} />
                    <span>Overview</span>
                </Link>
                <Link to={`/projects/${projectId}/apps`} className={`nav-item ${location.pathname.includes('/apps') ? 'active' : ''}`}>
                    <Server size={18} />
                    <span>Apps & Docker</span>
                </Link>
                <Link to={`/projects/${projectId}/kubernetes`} className={`nav-item ${location.pathname.includes('/kubernetes') ? 'active' : ''}`}>
                    <Layout size={18} />
                    <span>Kubernetes</span>
                </Link>
                <Link to={`/projects/${projectId}/settings`} className={`nav-item ${location.pathname.includes('/settings') ? 'active' : ''}`}>
                    <Settings size={18} />
                    <span>Settings</span>
                </Link>
                
                <div style={{ margin: '1rem 1.5rem', borderTop: '1px solid #374151' }}></div>
                
                <Link to="/" className="nav-item">
                    <Folder size={18} />
                    <span>All Projects</span>
                </Link>
            </div>
        ) : (
            /* Global Navigation (Dashboard) */
            <div className="nav-section">
                <h3 className="nav-header">Manage</h3>
                <Link to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
                    <Folder size={18} />
                    <span>Projects</span>
                </Link>
            </div>
        )}

        {/* Recent Projects List (Only on Dashboard or if needed) */}
        {!currentProject && projects && projects.length > 0 && (
            <div className="nav-section">
            <h3 className="nav-header">Recent Projects</h3>
            {projects.slice(0, 5).map(p => (
                <Link key={p.id} to={`/projects/${p.id}`} className="nav-item">
                    <div className="nav-project-dot"></div>
                    <span>{p.name}</span>
                </Link>
            ))}
            </div>
        )}
      </div>

      <div className="sidebar-footer">
        <Link to="/profile" className="nav-item">
          <Settings size={18} />
          <span>Account Settings</span>
        </Link>
      </div>
    </div>
  );
};

export default Sidebar;