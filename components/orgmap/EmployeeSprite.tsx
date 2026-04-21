// @ts-nocheck
import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';

interface EmployeeSpriteProps {
  employee: Employee;
  position: [number, number, number];
  scale?: number;
}

const EmployeeSprite: React.FC<EmployeeSpriteProps> = ({ employee, position, scale = 1 }) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const { setSelectedEmployee } = useOrgMapStore();

  const targetScale = useRef(scale);
  useFrame(() => {
    if (!meshRef.current) return;
    const goal = hovered ? scale * 1.35 : scale;
    targetScale.current += (goal - targetScale.current) * 0.12;
    meshRef.current.scale.setScalar(targetScale.current);
    // Billboard: always face camera
    meshRef.current.rotation.set(0, 0, 0);
  });

  const initial = employee.fullName?.charAt(0)?.toUpperCase() ?? '?';
  const colors = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#ec4899', '#f59e0b'];
  const color = colors[employee.fullName.charCodeAt(0) % colors.length];

  return (
    <group position={position}>
      {/* Avatar sphere */}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
        onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
      >
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.6 : 0.2}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>

      {/* Initial letter */}
      <Text
        position={[0, 0, 0.41]}
        fontSize={0.3}
        color="white"
        anchorX="center"
        anchorY="middle"
        font="/fonts/inter.woff"
      >
        {initial}
      </Text>

      {/* Name tag below */}
      <Html
        position={[0, -0.7, 0]}
        center
        occlude={false}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          background: hovered ? 'rgba(99,102,241,0.95)' : 'rgba(15,23,42,0.85)',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '10px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          fontFamily: 'Inter, sans-serif',
          border: hovered ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
          transition: 'all 0.2s',
          boxShadow: hovered ? '0 0 12px rgba(99,102,241,0.5)' : 'none',
        }}>
          {employee.fullName.split(' ').slice(-2).join(' ')}
        </div>
      </Html>

      {/* Hover glow ring */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.38, 0]}>
          <ringGeometry args={[0.5, 0.65, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};

export default EmployeeSprite;
