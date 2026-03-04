import React, { useState, useEffect, useContext } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import { AuthContext } from '../context/AuthContext';
import { 
  Plus, Server, Users, Trash2, Play, Square, RotateCw, MoreVertical, 
  Box, Globe, Terminal, Github, Container, Layers, Check, Cpu, MemoryStick, HardDrive 
} from 'lucide-react';
import { toast } from 'react-toastify';

const ProjectDetails = () => {
  const { id, category } = useParams();
  const { user: currentUser } = useContext(AuthContext);
  const [project, setProject] = useState(null);
  const [showVMModal, setShowVMModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  
  // State for VM Creation Wizard
  const [newVM, setNewVM] = useState({ 
    name: '', 
    type: 'app', 
    framework: 'node', 
    githubUrl: '', 
    dockerImage: '', 
    ram: 2048, 
    cpu: 2, 
    disk: 20 
  });
  const [selectedPlan, setSelectedPlan] = useState('basic'); // basic, standard, pro
  
  const [newUser, setNewUser] = useState({ email: '', role: 'viewer' });
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    fetchProject();
  }, [id]);

  // Filter VMs based on category
  const getFilteredVMs = () => {
    if (!project || !project.vms) return [];
    if (!category) return project.vms; 
    if (category === 'apps') {
      return project.vms.filter(vm => vm.type === 'app' || vm.type === 'docker');
    }
    if (category === 'kubernetes') {
      return project.vms.filter(vm => vm.type === 'k8s');
    }
    return [];
  };

  const filteredVMs = getFilteredVMs();
  const sectionTitle = !category ? 'Overview' : (category === 'apps' ? 'Apps & Docker' : 'Kubernetes Clusters');

  // Permissions Check
  const currentProjectUser = project?.users?.find(u => u.id === currentUser?.id);
  const permissions = currentProjectUser?.ProjectUser?.permissions || {};
  const isAdmin = currentProjectUser?.ProjectUser?.role === 'admin';

  const canCreate = isAdmin || permissions.canCreateVM;
  const canDelete = isAdmin || permissions.canDeleteVM;
  const canStartStop = isAdmin || permissions.canStartStopVM;
  const canManageAccess = isAdmin || permissions.canManageAccess;

  useEffect(() => {
    if (showVMModal) {
      fetchRepos();
    }
  }, [showVMModal]);

  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const response = await api.get('/github/repos');
      setRepos(response.data);
    } catch (error) {
      console.log('GitHub repos not available');
    } finally {
      setLoadingRepos(false);
    }
  };

  const fetchProject = async () => {
    try {
      const response = await api.get(`/projects/${id}`);
      setProject(response.data);
    } catch (error) {
      toast.error('Failed to fetch project details');
    }
  };

  const handleCreateVM = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${id}/vms`, newVM);
      toast.success('VM creation started');
      setShowVMModal(false);
      fetchProject();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create VM');
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post(`/projects/${id}/invite`, newUser);
      toast.success(response.data.message || 'Приглашение отправлено');
      setShowUserModal(false);
      setNewUser({ email: '', role: 'viewer' });
      fetchProject();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to send invitation');
    }
  };

  const handleVMAction = async (vmId, action) => {
    try {
      await api.post(`/vms/${vmId}/${action}`);
      toast.success(`VM ${action} command sent`);
      fetchProject();
    } catch (error) {
      toast.error(`Failed to ${action} VM`);
    }
  };

  const handleDeleteVM = async (vmId) => {
    if (!window.confirm('Are you sure you want to delete this VM?')) return;
    try {
      await api.delete(`/vms/${vmId}`);
      toast.success('VM deleted');
      fetchProject();
    } catch (error) {
      toast.error('Failed to delete VM');
    }
  };

  // Helper to update resources based on plan selection
  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    if (plan === 'basic') setNewVM({ ...newVM, ram: 1024, cpu: 1, disk: 20 });
    if (plan === 'standard') setNewVM({ ...newVM, ram: 2048, cpu: 2, disk: 40 });
    if (plan === 'pro') setNewVM({ ...newVM, ram: 4096, cpu: 4, disk: 80 });
    if (plan === 'custom') setNewVM({ ...newVM, ram: 2048, cpu: 2, disk: 20 });
  };

  if (!project) return <div>Loading...</div>;

  return (
    <div className="project-details-content">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{project.name}</h1>
          <p style={{ color: '#6b7280', margin: '5px 0 0 0' }}>{project.description}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {canManageAccess && (
            <button
              onClick={() => setShowUserModal(true)}
              className="btn-secondary"
              style={{ background: 'white', border: '1px solid #d1d5db', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <Users size={18} /> Invite
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setShowVMModal(true)}
              className="btn-create"
              style={{ backgroundColor: '#0069ff', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '600' }}
            >
              <Plus size={18} /> Create Resource
            </button>
          )}
        </div>
      </div>

      {/* Resources List */}
      <div className="resources-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="section-title" style={{ fontSize: '1.2rem', fontWeight: '600' }}>{sectionTitle}</h2>
        </div>
        <div className="resources-list" style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          {filteredVMs.map((vm) => (
            <div key={vm.id} className="resource-row" style={{ display: 'flex', alignItems: 'center', padding: '1rem', borderBottom: '1px solid #e5e7eb', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ background: '#f3f4f6', padding: '10px', borderRadius: '50%' }}>
                  {vm.type === 'k8s' ? <Box size={20} color="#3b82f6" /> : <Server size={20} color="#3b82f6" />}
                </div>
                <div>
                  <Link to={`/vms/${vm.id}`} style={{ fontWeight: '600', color: '#111827', textDecoration: 'none', fontSize: '1rem', display: 'block' }}>
                    {vm.name}
                  </Link>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '0.85rem', color: '#6b7280', marginTop: '4px' }}>
                    <span>{vm.type === 'app' ? vm.framework : (vm.type === 'docker' ? vm.dockerImage : 'Kubernetes')}</span>
                    <span>•</span>
                    <span>{vm.ip || 'No IP'}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <span className={`vm-status-tag ${
                  vm.status === 'running' ? 'vm-status-running' :
                  vm.status === 'deployed' ? 'vm-status-deployed' :
                  vm.status === 'error' ? 'vm-status-error' :
                  'vm-status-default'
                }`}>
                  {vm.status}
                </span>
                <div className="resource-actions" style={{ display: 'flex', gap: '5px' }}>
                  {vm.appUrl && (
                    <a href={vm.appUrl} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Open App">
                      <Globe size={18} />
                    </a>
                  )}
                  <Link to={`/vms/${vm.id}`} className="icon-btn" title="Console">
                    <Terminal size={18} />
                  </Link>
                  {canStartStop && (
                    <>
                      <button onClick={() => handleVMAction(vm.id, 'start')} className="icon-btn" title="Start"><Play size={18} /></button>
                      <button onClick={() => handleVMAction(vm.id, 'stop')} className="icon-btn" title="Stop"><Square size={18} /></button>
                    </>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDeleteVM(vm.id)} className="icon-btn" title="Delete" style={{ color: '#ef4444' }}><Trash2 size={18} /></button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredVMs.length === 0 && (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
              <p>No resources found in this category.</p>
              {canCreate && (
                <button onClick={() => setShowVMModal(true)} style={{ color: '#0069ff', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', marginTop: '10px' }}>
                  Create a resource
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* --- REDESIGNED VM MODAL (DigitalOcean Style) --- */}
      {showVMModal && (
        <div className="modal-overlay" style={{ zIndex: 1000, background: 'rgba(0,0,0,0.5)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '40px', overflowY: 'auto' }}>
          <div className="modal-card" style={{ width: '900px', maxWidth: '95%', background: 'white', borderRadius: '8px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '40px' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '20px 30px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="modal-title" style={{ margin: 0, fontSize: '1.5rem' }}>Create New Resource</h2>
              <button onClick={() => setShowVMModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: '#6b7280' }}>&times;</button>
            </div>

            <form onSubmit={handleCreateVM}>
              <div style={{ padding: '30px' }}>

                {/* Right Content Area */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                  
                  {/* Section 1: Deployment Type */}
                  <section>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '15px' }}>Choose Deployment Type</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                      {/* App Card */}
                      <div 
                        onClick={() => setNewVM({ ...newVM, type: 'app' })}
                        style={{
                          border: `2px solid ${newVM.type === 'app' ? '#0069ff' : '#e5e7eb'}`,
                          padding: '20px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          background: newVM.type === 'app' ? '#eff6ff' : 'white',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Github size={32} color={newVM.type === 'app' ? '#0069ff' : '#6b7280'} style={{ margin: '0 auto 10px' }} />
                        <div style={{ fontWeight: '600' }}>App</div>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '5px' }}>From GitHub Repo</div>
                      </div>

                      {/* Docker Card */}
                      <div 
                        onClick={() => setNewVM({ ...newVM, type: 'docker' })}
                        style={{
                          border: `2px solid ${newVM.type === 'docker' ? '#0069ff' : '#e5e7eb'}`,
                          padding: '20px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          background: newVM.type === 'docker' ? '#eff6ff' : 'white',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Container size={32} color={newVM.type === 'docker' ? '#0069ff' : '#6b7280'} style={{ margin: '0 auto 10px' }} />
                        <div style={{ fontWeight: '600' }}>Docker</div>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '5px' }}>Container Image</div>
                      </div>

                      {/* K8s Card */}
                      <div 
                        onClick={() => setNewVM({ ...newVM, type: 'k8s' })}
                        style={{
                          border: `2px solid ${newVM.type === 'k8s' ? '#0069ff' : '#e5e7eb'}`,
                          padding: '20px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          background: newVM.type === 'k8s' ? '#eff6ff' : 'white',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Layers size={32} color={newVM.type === 'k8s' ? '#0069ff' : '#6b7280'} style={{ margin: '0 auto 10px' }} />
                        <div style={{ fontWeight: '600' }}>Kubernetes</div>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '5px' }}>K3s Cluster</div>
                      </div>
                    </div>

                    {/* Dynamic Inputs based on Type */}
                    <div style={{ marginTop: '20px', background: '#f9fafb', padding: '20px', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                      {newVM.type === 'app' && (
                        <div>
                          <label style={{ display: 'block', fontWeight: '500', marginBottom: '8px', fontSize: '0.9rem' }}>GitHub Repository</label>
                          {repos.length > 0 ? (
                            <select
                              className="modal-form-input"
                              value={newVM.githubUrl}
                              onChange={(e) => {
                                const url = e.target.value;
                                setNewVM({ ...newVM, githubUrl: url });
                                const repo = repos.find(r => r.html_url === url);
                                if (repo && repo.language) {
                                  const lang = repo.language.toLowerCase();
                                  if (lang.includes('javascript') || lang.includes('typescript')) setNewVM(prev => ({ ...prev, framework: 'node' }));
                                  else if (lang.includes('python')) setNewVM(prev => ({ ...prev, framework: 'python' }));
                                }
                              }}
                              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                            >
                              <option value="">Select a repository...</option>
                              {repos.map(repo => (
                                <option key={repo.id} value={repo.html_url}>{repo.full_name}</option>
                              ))}
                            </select>
                          ) : (
                            <input 
                              type="text" 
                              className="modal-form-input" 
                              value={newVM.githubUrl} 
                              onChange={(e) => setNewVM({ ...newVM, githubUrl: e.target.value })} 
                              placeholder="https://github.com/user/repo" 
                              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                            />
                          )}
                          {newVM.githubUrl && (
                            <div style={{ marginTop: '10px', fontSize: '0.85rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <Check size={14} /> Framework Auto-Detection Enabled
                            </div>
                          )}
                        </div>
                      )}

                      {newVM.type === 'docker' && (
                        <div>
                          <label style={{ display: 'block', fontWeight: '500', marginBottom: '8px', fontSize: '0.9rem' }}>Docker Image</label>
                          <input 
                            type="text" 
                            className="modal-form-input" 
                            value={newVM.dockerImage} 
                            onChange={(e) => setNewVM({ ...newVM, dockerImage: e.target.value })} 
                            placeholder="e.g. nginx:latest, postgres:15" 
                            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                          />
                        </div>
                      )}

                      {newVM.type === 'k8s' && (
                        <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                          This will deploy a single-node K3s cluster. You can access it via the terminal or exposed API port.
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Section 2: Choose Plan */}
                  <section>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '15px' }}>Choose Plan</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                      {[
                        { id: 'basic', name: 'Basic', ram: '1 GB', cpu: '1 CPU', disk: '20 GB', price: '$5' },
                        { id: 'standard', name: 'Standard', ram: '2 GB', cpu: '2 CPU', disk: '40 GB', price: '$10' },
                        { id: 'pro', name: 'Pro', ram: '4 GB', cpu: '4 CPU', disk: '80 GB', price: '$20' },
                      ].map((plan) => (
                        <div
                          key={plan.id}
                          onClick={() => handlePlanSelect(plan.id)}
                          style={{
                            border: `2px solid ${selectedPlan === plan.id ? '#0069ff' : '#e5e7eb'}`,
                            padding: '15px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: selectedPlan === plan.id ? '#eff6ff' : 'white',
                            position: 'relative'
                          }}
                        >
                          {selectedPlan === plan.id && (
                            <div style={{ position: 'absolute', top: '-10px', right: '10px', background: '#0069ff', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Check size={14} />
                            </div>
                          )}
                          <div style={{ fontWeight: '600', marginBottom: '10px' }}>{plan.name}</div>
                          <div style={{ fontSize: '0.85rem', color: '#6b7280', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><MemoryStick size={14} /> {plan.ram}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Cpu size={14} /> {plan.cpu}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><HardDrive size={14} /> {plan.disk}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Custom Plan Toggle */}
                    <div style={{ marginTop: '15px' }}>
                       <button 
                        type="button"
                        onClick={() => handlePlanSelect('custom')}
                        style={{ background: 'none', border: 'none', color: '#0069ff', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
                       >
                         {selectedPlan === 'custom' ? 'Hide Custom Options' : 'Customize Resources'}
                       </button>
                    </div>

                    {selectedPlan === 'custom' && (
                      <div style={{ marginTop: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: '600' }}>RAM (MB)</label>
                          <input type="number" className="modal-form-input" value={newVM.ram} onChange={(e) => setNewVM({ ...newVM, ram: parseInt(e.target.value) })} style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: '600' }}>CPU (Cores)</label>
                          <input type="number" className="modal-form-input" value={newVM.cpu} onChange={(e) => setNewVM({ ...newVM, cpu: parseInt(e.target.value) })} style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: '600' }}>Disk (GB)</label>
                          <input type="number" className="modal-form-input" value={newVM.disk} onChange={(e) => setNewVM({ ...newVM, disk: parseInt(e.target.value) })} style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }} />
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Section 3: Finalize */}
                  <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: '20px' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '15px' }}>Finalize Details</h3>
                    <div style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'block', fontWeight: '500', marginBottom: '8px', fontSize: '0.9rem' }}>Hostname</label>
                      <input 
                        type="text" 
                        className="modal-form-input" 
                        value={newVM.name} 
                        onChange={(e) => setNewVM({ ...newVM, name: e.target.value })} 
                        placeholder="my-app-01" 
                        required
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                      />
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                      Your resource will be created in <strong>Default Region</strong>. SSH keys will be automatically injected.
                    </div>
                  </section>

                </div>
              </div>

              {/* Footer Actions */}
              <div style={{ padding: '20px 30px', background: '#f9fafb', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '10px', borderRadius: '0 0 8px 8px' }}>
                <button type="button" onClick={() => setShowVMModal(false)} className="btn-cancel" style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" className="btn-modal-create" style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', background: '#0069ff', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Create Resource</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Modal (Unchanged) */}
      {showUserModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Add Member</h2>
            <form onSubmit={handleAddUser}>
              <div className="modal-form-group">
                <label className="modal-form-label">Email</label>
                <input type="email" className="modal-form-input" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} required />
              </div>
              <div className="modal-form-group">
                <label className="modal-form-label">Role</label>
                <select className="modal-form-input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowUserModal(false)} className="btn-cancel">Cancel</button>
                <button type="submit" className="btn-modal-create btn-add-member-modal">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetails;