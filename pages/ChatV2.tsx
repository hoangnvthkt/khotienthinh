import React from 'react';
import ChatShell from '../components/chat-v2/ChatShell';
import { useApp } from '../context/AppContext';

const ChatV2: React.FC = () => {
  const { user, users } = useApp();
  return <ChatShell currentUser={user} users={users} />;
};

export default ChatV2;
