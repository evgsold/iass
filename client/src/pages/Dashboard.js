import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { Plus, Folder, MoreHorizontal } from 'lucide-react';
import { toast } from 'react-toastify';

const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (error) {
      toast.error('Failed to fetch projects');
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      await api.post('/projects', newProject);
      toast.success('Project created');
      setShowModal(false);
      setNewProject({ name: '', description: '' });
      fetchProjects();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create project');
    }
  };

  return (
    <div className="dashboard-content">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Projects</h1>
        <button
          onClick={() => setShowModal(true)}
          className="btn-create"
        >
          Create Project
        </button>
      </div>

      <div className="projects-grid">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="project-card"
          >
            <div className="project-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#e0e7ff', padding: '8px', borderRadius: '6px' }}>
                    <Folder className="project-card-icon" size={20} />
                </div>
                <h2 className="project-card-title">{project.name}</h2>
              </div>
              <MoreHorizontal size={16} color="#9ca3af" />
            </div>
            <p className="project-card-description">{project.description || 'No description provided.'}</p>
            <div className="project-card-role">
              {project.users?.[0]?.ProjectUser?.role || 'Owner'}
            </div>
          </Link>
        ))}
        
        {/* Empty state or "Create" card */}
        {projects.length === 0 && (
            <div className="project-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' }} onClick={() => setShowModal(true)}>
                <Plus size={32} color="#d1d5db" />
                <p style={{ color: '#6b7280', marginTop: '10px' }}>Create your first project</p>
            </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Create New Project</h2>
            <form onSubmit={handleCreateProject}>
              <div className="modal-form-group">
                <label className="modal-form-label">Name</label>
                <input
                  type="text"
                  className="modal-form-input"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  required
                  placeholder="My Awesome Project"
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-form-label">Description</label>
                <textarea
                  className="modal-form-textarea"
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="What is this project about?"
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-create"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;