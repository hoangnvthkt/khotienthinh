// @ts-nocheck
import React, { useRef, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';
import EmployeeSprite from './EmployeeSprite';

/* Room–type color palette */
const ROOM_COLORS: Record<string, string> = {
  'Phòng Hành chính nhân sự': '#6366f1',
  'Phòng Kế toán': '#0ea5e9',
  'Phòng trợ lý TGĐ': '#8b5cf6',
  'Phòng Thiết kế đấu thầu': '#f97316',
  'Phòng Thi công': '#10b981',
  'Phòng vật tư': '#f59e0b',
};
const DEFAULT_ROOM_COLOR = '#64748b';

/* Desk + Chair for one employee slot */
const WorkStation: React.FC<{
  position: [number, number, number];
  color: string;
  employee?: Employee;
}> = ({ position, color, employee }) => {
  const { setSelectedEmployee } = useOrgMapStore();
  const [hovered, setHovered] = useState(false);

  const initial = employee?.fullName?.charAt(0)?.toUpperCase() ?? '?';
  const avatarColor = employee
    ? ['#6366f1','#0ea5e9','#8b5cf6','#f97316','#10b981','#ec4899','#f59e0b'][
        employee.fullName.charCodeAt(0) % 7
      ]
    : '#334155';

  return (
    <group position={position}>
      {/* Desk surface */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.06, 0.6]} />
        <meshStandardMaterial color="#7c5c3e" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Desk legs x4 */}
      {[[-0.38, -0.26], [0.38, -0.26], [-0.38, 0.26], [0.38, 0.26]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0, lz]}>
          <boxGeometry args={[0.05, 0.36, 0.05]} />
          <meshStandardMaterial color="#5a3e28" roughness={0.8} />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 0.42, -0.22]}>
        <boxGeometry args={[0.5, 0.32, 0.03]} />
        <meshStandardMaterial color="#0f172a" emissive="#1e40af" emissiveIntensity={0.3} roughness={0.1} metalness={0.8} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.26, -0.22]}>
        <boxGeometry args={[0.06, 0.1, 0.06]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.6} />
      </mesh>

      {/* Chair seat */}
      <mesh position={[0, 0.06, 0.5]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Chair back */}
      <mesh position={[0, 0.28, 0.73]}>
        <boxGeometry args={[0.48, 0.42, 0.05]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Employee avatar (person above chair) */}
      {employee && (
        <group position={[0, 0.7, 0.5]}>
          {/* Body cylinder */}
          <mesh
            onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
            onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
          >
            <cylinderGeometry args={[0.15, 0.18, 0.5, 12]} />
            <meshStandardMaterial
              color={avatarColor}
              emissive={avatarColor}
              emissiveIntensity={hovered ? 0.6 : 0.15}
              roughness={0.3}
              metalness={0.4}
            />
          </mesh>
          {/* Head sphere */}
          <mesh position={[0, 0.38, 0]}>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshStandardMaterial
              color={avatarColor}
              emissive={avatarColor}
              emissiveIntensity={hovered ? 0.5 : 0.1}
              roughness={0.3}
              metalness={0.4}
            />
          </mesh>
          {/* Initial letter on head */}
          <Text
            position={[0, 0.38, 0.19]}
            fontSize={0.15}
            color="white"
            anchorX="center"
            anchorY="middle"
          >
            {initial}
          </Text>
          {/* Name tag (visible when room is selected) */}
          <Html position={[0, 0.65, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{
              background: hovered ? `${avatarColor}ee` : 'rgba(10,15,30,0.82)',
              color: 'white',
              padding: '2px 7px',
              borderRadius: 10,
              fontSize: 9,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              fontFamily: 'Inter, sans-serif',
              border: `1px solid ${avatarColor}55`,
              boxShadow: hovered ? `0 0 10px ${avatarColor}88` : 'none',
              transition: 'all 0.2s',
            }}>
              {employee.fullName.split(' ').slice(-2).join(' ')}
            </div>
          </Html>
          {/* Glow ring under feet */}
          {hovered && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.26, 0]}>
              <ringGeometry args={[0.22, 0.32, 24]} />
              <meshBasicMaterial color={avatarColor} transparent opacity={0.5} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
};

interface RoomProps {
  unit: OrgUnit;
  position: [number, number, number];
  employees: Employee[];
  width?: number;
  depth?: number;
  height?: number;
  worldOffset?: [number, number, number]; // parent group's world position
}

const Room: React.FC<RoomProps> = ({
  unit,
  position,
  employees,
  width = 5.2,
  depth = 3.6,
  height = 1.9,
  worldOffset = [0, 0, 0],
}) => {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const { selectedUnit, setSelectedUnit, setCameraMode, setRoomWorldPos } = useOrgMapStore();
  const isSelected = selectedUnit?.id === unit.id;

  const accentColor = ROOM_COLORS[unit.name] ?? DEFAULT_ROOM_COLOR;

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    const targetEmissive = hovered || isSelected ? 0.3 : 0.05;
    mat.emissiveIntensity += (targetEmissive - mat.emissiveIntensity) * 0.1;
  });

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (isSelected) {
      setSelectedUnit(null);
      setRoomWorldPos(null);
      setCameraMode('hq');
    } else {
      setSelectedUnit(unit);
      // Tính world position = parent offset + local position
      const worldPos: [number, number, number] = [
        worldOffset[0] + position[0],
        worldOffset[1] + position[1],
        worldOffset[2] + position[2],
      ];
      setRoomWorldPos(worldPos);
      setCameraMode({ type: 'room', unitId: unit.id });
    }
  }, [isSelected, unit, position, worldOffset, setSelectedUnit, setRoomWorldPos, setCameraMode]);

  const empCount = employees.length;

  // Layout nhân viên theo grid: tự động tính hàng/cột
  const cols = Math.min(empCount, 3);
  const rows = Math.ceil(empCount / Math.max(cols, 1));
  const cellW = (width - 0.6) / Math.max(cols, 1);
  const cellD = (depth - 0.5) / Math.max(rows, 1);

  return (
    <group ref={groupRef} position={position}>
      {/* Interior point light when selected */}
      {isSelected && (
        <pointLight
          position={[0, 0.5, 0]}
          intensity={2.5}
          color="#ffffff"
          distance={8}
          decay={2}
        />
      )}

      {/* Room box — glass material, fully invisible when selected */}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color="#1e293b"
          emissive={accentColor}
          emissiveIntensity={0.05}
          transparent
          opacity={isSelected ? 0.0 : hovered ? 0.45 : 0.68}
          roughness={0.1}
          metalness={0.3}
          depthWrite={!isSelected}
        />
      </mesh>

      {/* Colored accent border (top edge) */}
      <mesh position={[0, height / 2 + 0.03, 0]}>
        <boxGeometry args={[width + 0.04, 0.06, depth + 0.04]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={isSelected ? 1.5 : 0.8} />
      </mesh>

      {/* Selection glow outline */}
      {isSelected && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[width + 0.15, height + 0.15, depth + 0.15]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.4}
            transparent
            opacity={0.08}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* Room name */}
      <Text
        position={[0, height / 2 + 0.3, 0]}
        fontSize={0.22}
        color="white"
        anchorX="center"
        anchorY="bottom"
        maxWidth={width - 0.4}
        textAlign="center"
        outlineWidth={0.01}
        outlineColor={accentColor}
      >
        {unit.name}
      </Text>

      {/* Employee count badge */}
      {empCount > 0 && (
        <Html position={[width / 2 - 0.4, height / 2 + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: accentColor,
            color: 'white',
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 900,
            fontFamily: 'Inter, sans-serif',
            boxShadow: `0 0 8px ${accentColor}88`,
          }}>
            {empCount}
          </div>
        </Html>
      )}

      {/* Click hint when not selected */}
      {hovered && !isSelected && (
        <Html position={[0, -height / 2 - 0.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: `${accentColor}dd`,
            color: 'white',
            padding: '3px 10px',
            borderRadius: 12,
            fontSize: 9,
            fontWeight: 700,
            fontFamily: 'Inter, sans-serif',
            whiteSpace: 'nowrap',
          }}>
            {empCount > 0 ? `Click để vào phòng (${empCount} NV)` : 'Click để xem phòng'}
          </div>
        </Html>
      )}

      {/* Floor plane inside room */}
      <mesh position={[0, -height / 2 + 0.01, 0]} receiveShadow>
        <planeGeometry args={[width - 0.1, depth - 0.1]} />
        <meshStandardMaterial
          color={accentColor}
          transparent
          opacity={isSelected ? 0.15 : 0.07}
          roughness={1}
        />
      </mesh>

      {/* ===== OFFICE INTERIOR (always rendered, visible when selected/zoomed) ===== */}
      {employees.map((emp, i) => {
        const col = i % Math.max(cols, 1);
        const row = Math.floor(i / Math.max(cols, 1));
        const x = (col - (cols - 1) / 2) * cellW;
        const z = (row - (rows - 1) / 2) * cellD;
        return (
          <WorkStation
            key={emp.id}
            position={[x, -height / 2 + 0.12, z]}
            color={accentColor}
            employee={emp}
          />
        );
      })}

      {/* Empty room placeholder */}
      {empCount === 0 && isSelected && (
        <Html position={[0, 0, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(10,15,30,0.85)',
            color: '#64748b',
            padding: '6px 14px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'Inter, sans-serif',
            border: `1px solid ${accentColor}33`,
          }}>
            Chưa có nhân viên
          </div>
        </Html>
      )}
    </group>
  );
};

export default Room;
