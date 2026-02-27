import React, { useContext } from 'react';
import { Search, Bell, HelpCircle, User, LogOut } from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const TopBar = ({ onCreateClick }) => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="topbar">
      <div className="topbar-search">
        <Search size={16} className="search-icon" />
        <input type="text" placeholder="Search resources..." className="search-input" />
      </div>

      <div className="topbar-actions">
        <button className="btn-create" onClick={onCreateClick}>
          Create
        </button>
        
        <div className="topbar-icons">
          <button className="icon-btn"><HelpCircle size={20} /></button>
          <button className="icon-btn"><Bell size={20} /></button>
          
          <div className="user-menu">
            <div className="user-avatar">
                {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="avatar" />
                ) : (
                    <User size={20} />
                )}
            </div>
            <button onClick={handleLogout} className="icon-btn" title="Logout">
                <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TopBar;