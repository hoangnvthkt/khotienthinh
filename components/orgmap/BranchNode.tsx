// @ts-nocheck
import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';
import EmployeeSprite from './EmployeeSprite';

/* Per-type visual config */
type BranchVisual = {
  color: string;
  emissive: string;
  label: string;
  shape: 'box' | 'cylinder' | 'cone';
  height: number;
  radius?: number;
  width?: number;
  depth?: number;
};

const BRANCH_VISUALS: Record<string, BranchVisual> = {
  factory: {
    color: '#8b5cf6',
    emissive: '#7c3aed',
    label: 'NHÀ MÁY',
    shape: 'cylinder',
    height: 5,
    radius: 2.8,
  },
  custom: {
    // chi nhánh (văn phòng HN)
    color: '#0ea5e9',
    emissive: '#0284c7',
    label: 'CHI NHÁNH',
    shape: 'box',
    height: 4.5,
    width: 6,
    depth: 6,
  },
  construction_site: {
    color: '#f97316',
    emissive: '#ea580c',
    label: 'CÔNG TRƯỜNG',
    shape: 'cone',
    height: 5,
    radius: 2.5,
  },
};

const getVisual = (type: string): BranchVisual =>
  BRANCH_VISUALS[type] ?? BRANCH_VISUALS.custom;

interface BranchNodeProps {
  unit: OrgUnit;
  position: [number, number, number];
  employees: Employee[];
}

const BranchNode: React.FC<BranchNodeProps> = ({ unit, position, employees }) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const { cameraMode, setCameraMode, expandedBranches, toggleBranch } = useOrgMapStore();
  const isExpanded = expandedBranches.has(unit.id);

  const vis = getVisual(unit.type);

  const targetEmissive = useRef(0.15);
  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    const goal = hovered || isExpanded ? 0.7 : 0.15;
    targetEmissive.current += (goal - targetEmissive.current) * 0.1;
    mat.emissiveIntensity = targetEmissive.current;
  });

  const handleClick = (e: any) => {
    e.stopPropagation();
    toggleBranch(unit.id);
    if (!isExpanded) {
      setCameraMode({ type: 'branch', unitId: unit.id });
    } else {
      setCameraMode('overview');
    }
  };

  const empPositions: [number, number, number][] = employees.map((_, i) => {
    const angle = (i / Math.max(employees.length, 1)) * Math.PI * 2;
    const r = 3.5 + Math.floor(i / 8) * 1.5;
    return [Math.cos(angle) * r, vis.height / 2 + 0.5, Math.sin(angle) * r];
  });

  return (
    <Float speed={1.2} rotationIntensity={0.05} floatIntensity={0.3}>
      <group position={position}>
        {/* Base platform */}
        <mesh position={[0, -0.2, 0]} receiveShadow>
          <cylinderGeometry args={[vis.radius ?? 3.5, (vis.radius ?? 3.5) + 0.5, 0.4, 32]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} metalness={0.2} />
        </mesh>

        {/* Main shape */}
        <mesh
          ref={meshRef}
          position={[0, vis.height / 2, 0]}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
          onClick={handleClick}
          castShadow
        >
          {vis.shape === 'cylinder' && (
            <cylinderGeometry args={[vis.radius! * 0.7, vis.radius!, vis.height, 32]} />
          )}
          {vis.shape === 'box' && (
            <boxGeometry args={[vis.width!, vis.height, vis.depth!]} />
          )}
          {vis.shape === 'cone' && (
            <coneGeometry args={[vis.radius!, vis.height, 6]} />
          )}
          <meshStandardMaterial
            color={vis.color}
            emissive={vis.emissive}
            emissiveIntensity={0.15}
            roughness={0.25}
            metalness={0.55}
          />
        </mesh>

        {/* Glow ring at base */}
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[(vis.radius ?? 3) + 0.2, (vis.radius ?? 3) + 1.0, 64]} />
          <meshBasicMaterial
            color={vis.color}
            transparent
            opacity={hovered || isExpanded ? 0.45 : 0.15}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Name label */}
        <Text
          position={[0, vis.height + 1.0, 0]}
          fontSize={0.5}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.025}
          outlineColor={vis.color}
        >
          {unit.name}
        </Text>

        {/* Type badge */}
        <Html position={[0, vis.height + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: vis.color,
            color: 'white',
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: 9,
            fontWeight: 900,
            fontFamily: 'Inter,sans-serif',
            letterSpacing: '0.12em',
            boxShadow: `0 0 12px ${vis.color}88`,
          }}>
            {vis.label}
          </div>
        </Html>

        {/* Employee count bubble */}
        {employees.length > 0 && (
          <Html position={[(vis.radius ?? 3), vis.height, 0]} center style={{ pointerEvents: 'none' }}>
            <div style={{
              background: vis.color,
              color: 'white',
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 900,
              fontFamily: 'Inter,sans-serif',
              boxShadow: `0 0 10px ${vis.color}`,
            }}>
              {employees.length}
            </div>
          </Html>
        )}

        {/* Expanded: show employees around node */}
        {isExpanded && employees.map((emp, i) => (
          <EmployeeSprite
            key={emp.id}
            employee={emp}
            position={empPositions[i]}
            scale={0.8}
          />
        ))}

        {/* Hint */}
        {hovered && !isExpanded && employees.length > 0 && (
          <Html position={[0, -0.8, 0]} center style={{ pointerEvents: 'none' }}>
            <div style={{
              background: `${vis.color}ee`,
              color: 'white',
              padding: '3px 12px',
              borderRadius: 14,
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'Inter,sans-serif',
            }}>
              Click để xem {employees.length} nhân viên
            </div>
          </Html>
        )}
      </group>
    </Float>
  );
};

export default BranchNode;
