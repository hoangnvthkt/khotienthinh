
import { InventoryItem, Role, Supplier, Transaction, TransactionStatus, TransactionType, User, Warehouse } from './types';

export const CURRENT_USER: User = {
  id: 'u1',
  name: 'Nguyễn Văn A',
  email: 'admin@khoviet.com',
  username: 'admin',
  password: '123',
  role: Role.ADMIN,
  avatar: 'https://i.pravatar.cc/150?u=u1',
};

export const MOCK_USERS: User[] = [
  {
    id: 'u1',
    name: 'Nguyễn Văn Admin',
    email: 'admin@khoviet.com',
    username: 'admin',
    password: '123',
    role: Role.ADMIN,
    avatar: 'https://i.pravatar.cc/150?u=u1',
  },
  {
    id: 'u2',
    name: 'Trần Thủ Kho A',
    email: 'khoa@khoviet.com',
    username: 'khoa',
    password: '123',
    role: Role.KEEPER,
    avatar: 'https://i.pravatar.cc/150?u=u2',
    assignedWarehouseId: 'wh2', // Giao quản lý kho Công trình A
  },
  {
    id: 'u3',
    name: 'Lê Thủ Kho Tổng',
    email: 'khotong@khoviet.com',
    username: 'khotong',
    password: '123',
    role: Role.KEEPER,
    avatar: 'https://i.pravatar.cc/150?u=u3',
    assignedWarehouseId: 'wh1', // Giao quản lý kho Tổng
  }
];

export const MOCK_WAREHOUSES: Warehouse[] = [
  { id: 'wh1', name: 'Kho Tổng (Hà Nội)', address: 'KCN Thăng Long', type: 'GENERAL' },
  { id: 'wh2', name: 'Kho Công Trình A', address: 'Quận 2, TP.HCM', type: 'SITE' },
  { id: 'wh3', name: 'Kho Công Trình B', address: 'Quận Bình Thạnh, TP.HCM', type: 'SITE' },
];

export const MOCK_SUPPLIERS: Supplier[] = [];

export const MOCK_ITEMS: InventoryItem[] = [];

export const MOCK_TRANSACTIONS: Transaction[] = [];
