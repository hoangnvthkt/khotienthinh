// @ts-nocheck
import React, { useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';

/* === SCALE CONFIG === */
const FLOOR_HEIGHT = 4.2;
const BUILDING_W = 34;
const BUILDING_D = 24;
const ROOM_H = 3.8;
const RW = 15;   // room width
const RD = 10;   // room depth

/* Room accent colors */
const ROOM_COLORS: Record<string, string> = {
  'Phòng Hành chính nhân sự': '#6366f1',
  'Phòng Kế toán':            '#0ea5e9',
  'Phòng trợ lý TGĐ':         '#8b5cf6',
  'Phòng Thiết kế đấu thầu':   '#f97316',
  'Phòng Thi công':             '#10b981',
  'Phòng vật tư':               '#f59e0b',
};
const DEFAULT_COLOR = '#64748b';

/* ───────────── FURNITURE PRIMITIVES ───────────── */
const Desk: React.FC<{ position: [number,number,number]; rotation?: number }> = ({ position, rotation = 0 }) => (
  <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 0.3, 0]} castShadow>
      <boxGeometry args={[1.4, 0.07, 0.9]} />
      <meshStandardMaterial color="#8B6343" roughness={0.4} />
    </mesh>
    {([[-0.6,-0.35],[0.6,-0.35],[-0.6,0.35],[0.6,0.35]] as [number,number][]).map(([lx,lz],i) => (
      <mesh key={i} position={[lx, 0.12, lz]}>
        <boxGeometry args={[0.06, 0.42, 0.06]} />
        <meshStandardMaterial color="#5a3e28" />
      </mesh>
    ))}
    {/* Monitor */}
    <mesh position={[0, 0.62, -0.32]}>
      <boxGeometry args={[0.7, 0.44, 0.04]} />
      <meshStandardMaterial color="#0f172a" emissive="#1e3a5f" emissiveIntensity={0.5} metalness={0.8} />
    </mesh>
    <mesh position={[0, 0.42, -0.32]}>
      <boxGeometry args={[0.07, 0.14, 0.07]} />
      <meshStandardMaterial color="#1e293b" metalness={0.6} />
    </mesh>
    {/* Chair */}
    <mesh position={[0, 0.14, 0.65]}>
      <boxGeometry args={[0.66, 0.08, 0.62]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.42, 0.94]}>
      <boxGeometry args={[0.64, 0.52, 0.07]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
  </group>
);

const DeskCluster: React.FC<{ position: [number,number,number] }> = ({ position }) => (
  <group position={position}>
    <Desk position={[-0.8, 0,  0.55]} rotation={0} />
    <Desk position={[ 0.8, 0,  0.55]} rotation={0} />
    <Desk position={[-0.8, 0, -0.55]} rotation={Math.PI} />
    <Desk position={[ 0.8, 0, -0.55]} rotation={Math.PI} />
    <mesh position={[0, 0.4, 0]}>
      <boxGeometry args={[1.72, 0.55, 0.06]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.45} />
    </mesh>
  </group>
);

const MeetingTable: React.FC<{ position: [number,number,number]; seats?: number }> = ({ position, seats = 6 }) => (
  <group position={position}>
    <mesh position={[0, 0.34, 0]}>
      <cylinderGeometry args={[2.2, 2.0, 0.14, 32]} />
      <meshStandardMaterial color="#7c5c3e" roughness={0.4} />
    </mesh>
    <mesh position={[0, 0.16, 0]}>
      <cylinderGeometry args={[0.14, 0.22, 0.36, 16]} />
      <meshStandardMaterial color="#4b3016" metalness={0.4} />
    </mesh>
    {Array.from({ length: Math.min(seats, 10) }).map((_, i) => {
      const angle = (i / Math.min(seats, 10)) * Math.PI * 2;
      const r = 2.8;
      return (
        <group key={i} position={[Math.cos(angle)*r, 0, Math.sin(angle)*r]} rotation={[0, -angle + Math.PI, 0]}>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.56, 0.08, 0.56]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.4, 0.3]}>
            <boxGeometry args={[0.54, 0.44, 0.07]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
        </group>
      );
    })}
  </group>
);

const GlassWall: React.FC<{ position: [number,number,number]; width: number; rotation?: number }> = ({
  position, width, rotation = 0,
}) => (
  <mesh position={position} rotation={[0, rotation, 0]}>
    <boxGeometry args={[width, 2.6, 0.07]} />
    <meshStandardMaterial color="#94a3b8" transparent opacity={0.2} metalness={0.5} roughness={0.05} />
  </mesh>
);

/* ───────────── SMALL PERSON AVATAR ───────────── */
const PersonAvatar: React.FC<{ employee: Employee; position: [number,number,number] }> = ({ employee, position }) => {
  const { setSelectedEmployee } = useOrgMapStore();
  const [hov, setHov] = useState(false);
  const ref = useRef<THREE.Mesh>(null!);
  const COLORS = ['#6366f1','#0ea5e9','#8b5cf6','#f97316','#10b981','#ec4899','#f59e0b'];
  const color = COLORS[employee.fullName.charCodeAt(0) % COLORS.length];
  const initial = employee.fullName.charAt(0).toUpperCase();

  useFrame(() => {
    if (!ref.current) return;
    const g = hov ? 1.25 : 1.0;
    ref.current.scale.lerp(new THREE.Vector3(g, g, g), 0.15);
  });

  return (
    <group position={position}>
      <mesh
        ref={ref}
        onPointerOver={e => { e.stopPropagation(); setHov(true); document.body.style.cursor='pointer'; }}
        onPointerOut={() => { setHov(false); document.body.style.cursor='default'; }}
        onClick={e => { e.stopPropagation(); setSelectedEmployee(employee); }}
      >
        <cylinderGeometry args={[0.17, 0.21, 0.52, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hov?0.7:0.2} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.19, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hov?0.5:0.12} roughness={0.3} />
      </mesh>
      <Text position={[0, 0.42, 0.2]} fontSize={0.16} color="white" anchorX="center" anchorY="middle">{initial}</Text>
      <Html position={[0, 0.74, 0]} center distanceFactor={8} style={{ pointerEvents:'none', userSelect:'none' }}>
        <div style={{
          background: hov ? `${color}ee` : 'rgba(6,10,24,0.85)',
          color: 'white', padding: '1px 5px', borderRadius: 7,
          fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap',
          fontFamily: 'Inter,sans-serif', border: `1px solid ${color}44`,
          boxShadow: hov ? `0 0 8px ${color}66` : 'none',
        }}>
          {employee.fullName.split(' ').pop()}
        </div>
      </Html>
      {hov && (
        <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.27,0]}>
          <ringGeometry args={[0.25,0.36,24]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};

/* ───────────── ROOM BOX ───────────── */
interface RoomProps {
  unit: OrgUnit;
  position: [number,number,number];
  employees: Employee[];
  buildingPos?: [number,number,number];
  floorY?: number;
}

const CLUSTER_POS: [number,number,number][] = [
  [-4.5, 0,  3.0],
  [ 1.8, 0,  3.0],
  [-4.5, 0, -1.2],
  [ 1.8, 0, -1.2],
];
const SEAT_OFFSETS: [number,number,number][] = [
  [-0.8, 0.6,  0.55],
  [ 0.8, 0.6,  0.55],
  [-0.8, 0.6, -0.55],
  [ 0.8, 0.6, -0.55],
];

const RoomBox: React.FC<RoomProps> = ({ unit, position, employees, buildingPos=[0,0,0], floorY=0 }) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hov, setHov] = useState(false);
  const { selectedUnit, setSelectedUnit, setCameraMode, setRoomWorldPos, setActiveRoomId } = useOrgMapStore();
  const isSelected = selectedUnit?.id === unit.id;
  const accentColor = ROOM_COLORS[unit.name] ?? DEFAULT_COLOR;
  const empCount = employees.length;

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity += ((hov || isSelected ? 0.3 : 0.05) - mat.emissiveIntensity) * 0.1;
    mat.opacity += ((isSelected ? 0.0 : hov ? 0.35 : 0.62) - mat.opacity) * 0.1;
  });

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    // Open dedicated room scene (separate canvas)
    setActiveRoomId(unit.id);
  }, [unit.id, setActiveRoomId]);

  return (
    <group position={position}>
      {isSelected && <pointLight position={[0, 1.2, 0]} intensity={5} color="#fff8f0" distance={22} decay={2} />}

      {/* Walls */}
      <mesh
        ref={meshRef}
        onPointerOver={e => { e.stopPropagation(); setHov(true); document.body.style.cursor='pointer'; }}
        onPointerOut={() => { setHov(false); document.body.style.cursor='default'; }}
        onClick={handleClick}
        castShadow receiveShadow
      >
        <boxGeometry args={[RW, ROOM_H, RD]} />
        <meshStandardMaterial
          color="#0f1829" emissive={accentColor} emissiveIntensity={0.05}
          transparent opacity={0.62} roughness={0.08} metalness={0.3}
          depthWrite={!isSelected}
        />
      </mesh>

      {/* Top accent bar */}
      <mesh position={[0, ROOM_H/2 + 0.06, 0]}>
        <boxGeometry args={[RW + 0.08, 0.12, RD + 0.08]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={isSelected ? 2.2 : 0.9} />
      </mesh>

      {/* Glow shell */}
      {isSelected && (
        <mesh>
          <boxGeometry args={[RW + 0.3, ROOM_H + 0.3, RD + 0.3]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.35} transparent opacity={0.07} side={THREE.BackSide} />
        </mesh>
      )}

      {/* Floor */}
      <mesh position={[0, -ROOM_H/2 + 0.02, 0]} receiveShadow>
        <planeGeometry args={[RW - 0.2, RD - 0.2]} />
        <meshStandardMaterial color={accentColor} transparent opacity={isSelected ? 0.16 : 0.05} roughness={1} />
      </mesh>

      {/* Furniture */}
      {CLUSTER_POS.slice(0, Math.max(2, Math.ceil(employees.length/4))).map((cp, i) => (
        <DeskCluster key={i} position={[cp[0], -ROOM_H/2 + 0.02, cp[2]]} />
      ))}
      <MeetingTable position={[5.5, -ROOM_H/2 + 0.02, -3.0]} seats={Math.max(4, Math.min(8, empCount))} />
      <GlassWall position={[0.8, -ROOM_H/2 + 1.3, 0.8]} width={RW - 4} />
      <GlassWall position={[3.0, -ROOM_H/2 + 1.3, 0]} width={RD - 2} rotation={Math.PI/2} />

      {/* Reception */}
      <mesh position={[-5.6, -ROOM_H/2 + 0.44, -3.4]} castShadow>
        <boxGeometry args={[3.2, 0.88, 1.1]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.3} />
      </mesh>

      {/* ── DOOR on front face ── */}
      {/* Left door post */}
      <mesh position={[-1.5, -ROOM_H/2 + 1.5, RD/2 + 0.02]}>
        <boxGeometry args={[0.16, 3.0, 0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Right door post */}
      <mesh position={[1.5, -ROOM_H/2 + 1.5, RD/2 + 0.02]}>
        <boxGeometry args={[0.16, 3.0, 0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Lintel above door */}
      <mesh position={[0, -ROOM_H/2 + 3.1, RD/2 + 0.02]}>
        <boxGeometry args={[3.2, 0.2, 0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Door panel (slightly ajar) */}
      <group position={[-1.4, -ROOM_H/2, RD/2]} rotation={[0, -Math.PI/7, 0]}>
        <mesh position={[1.35, 1.5, 0.05]}>
          <boxGeometry args={[2.7, 2.9, 0.07]} />
          <meshStandardMaterial color={accentColor} transparent opacity={0.55} metalness={0.3} roughness={0.05} />
        </mesh>
        <mesh position={[2.4, 1.5, 0.10]} rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.20, 8]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>

      {/* Room label ABOVE door */}
      <Html
        position={[0, -ROOM_H/2 + 3.55, RD/2 + 0.3]}
        center
        distanceFactor={22}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          background: hov ? `${accentColor}dd` : 'rgba(6,10,24,0.92)',
          color: 'white',
          border: `1.5px solid ${accentColor}${hov ? 'ff' : '66'}`,
          padding: '2px 10px',
          borderRadius: 9,
          fontSize: 10,
          fontWeight: 800,
          whiteSpace: 'nowrap',
          fontFamily: 'Inter, sans-serif',
          backdropFilter: 'blur(6px)',
          boxShadow: hov ? `0 0 16px ${accentColor}88` : 'none',
          transition: 'all 0.2s',
        }}>
          {unit.name}
        </div>
      </Html>

      {/* Badge */}
      {empCount > 0 && (
        <Html position={[RW/2 - 0.9, ROOM_H/2 + 0.5, 0]} center distanceFactor={16} style={{ pointerEvents:'none' }}>
          <div style={{
            background: accentColor, color: 'white',
            width: 24, height: 24, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, fontFamily: 'Inter,sans-serif',
            boxShadow: `0 0 12px ${accentColor}88`,
          }}>{empCount}</div>
        </Html>
      )}

      {/* Hover hint */}
      {hov && !isSelected && (
        <Html position={[0, -ROOM_H/2 - 0.35, 0]} center style={{ pointerEvents:'none' }}>
          <div style={{
            background: `${accentColor}dd`, color:'white',
            padding:'3px 10px', borderRadius:12,
            fontSize:10, fontWeight:700, fontFamily:'Inter,sans-serif', whiteSpace:'nowrap',
          }}>
            {empCount > 0 ? `Vào phòng (${empCount} NV)` : 'Vào phòng'}
          </div>
        </Html>
      )}

      {/* Employees */}
      {employees.map((emp, i) => {
        const ci = Math.floor(i/4) % 4;
        const si = i % 4;
        const base = CLUSTER_POS[ci] ?? CLUSTER_POS[0];
        const off = SEAT_OFFSETS[si];
        return (
          <PersonAvatar
            key={emp.id}
            employee={emp}
            position={[base[0]+off[0], -ROOM_H/2+off[1], base[2]+off[2]]}
          />
        );
      })}
    </group>
  );
};

/* ───────────── SPIRAL STAIRCASE ───────────── */
const SpiralStaircase: React.FC<{ height: number }> = ({ height }) => {
  const steps = Math.floor(height * 4);
  return (
    <group position={[0, height / 2, 0]}>
      {/* Central pillar */}
      <mesh>
        <cylinderGeometry args={[0.1, 0.1, height, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Steps */}
      {Array.from({ length: steps }).map((_, i) => {
        const h = -height / 2 + (i / steps) * height;
        const angle = i * 0.5;
        return (
          <group key={i} position={[0, h, 0]} rotation={[0, -angle, 0]}>
            <mesh position={[0.4, 0, 0]}>
              <boxGeometry args={[0.8, 0.04, 0.3]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};

/* ───────────── FLOOR SLAB ───────────── */
interface FloorSlabProps {
  rooms: OrgUnit[];
  allEmployees: Employee[];
  floorY: number;
  buildingPos: [number,number,number];
  buildingColor: string;
}

const FloorSlab: React.FC<FloorSlabProps> = ({ rooms, allEmployees, floorY, buildingPos, buildingColor }) => {
  const ROOM_POS: [number,number,number][] = [
    [-(RW/2 + 0.6), FLOOR_HEIGHT/2 + 0.12, 0],
    [ (RW/2 + 0.6), FLOOR_HEIGHT/2 + 0.12, 0],
  ];

  return (
    <group position={[0, floorY, 0]}>
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[BUILDING_W, 0.22, BUILDING_D]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.2} transparent opacity={0.88} />
      </mesh>
      <mesh position={[-BUILDING_W/2 - 0.9, 0.8, 0]} rotation={[0, Math.PI/2, 0]}>
        <planeGeometry args={[3.5, 0.7]} />
        <meshBasicMaterial color={buildingColor} transparent opacity={0.7} />
      </mesh>

      {/* Staircase between rooms */}
      <SpiralStaircase height={FLOOR_HEIGHT} />

      {rooms.map((room, i) => (
        <RoomBox
          key={room.id}
          unit={room}
          position={ROOM_POS[i] ?? ROOM_POS[0]}
          employees={allEmployees.filter(e => e.orgUnitId === room.id)}
          buildingPos={buildingPos}
          floorY={floorY}
        />
      ))}
    </group>
  );
};

/* ───────────── HQ BUILDING ───────────── */
interface HQBuildingProps {
  unit: OrgUnit;
  rooms: OrgUnit[];
  allEmployees: Employee[];
  position?: [number,number,number];
  label?: string;
  minFloors?: number;
  buildingColor?: string;
}

const HQBuilding: React.FC<HQBuildingProps> = ({ unit, rooms, allEmployees, position=[0,0,0], label='TRỤ SỞ CHÍNH', minFloors=1, buildingColor='#6366f1' }) => {
  const [hovered, setHovered] = useState(false);
  const { cameraMode, setCameraMode, setSelectedUnit, selectedUnit } = useOrgMapStore();
  const isOverview = cameraMode === 'overview';

  const fullRooms = [
    ...rooms,
    ...Array.from({ length: Math.max(0, minFloors * 2 - rooms.length) }).map((_, i) => ({
      id: `dummy-${unit.id}-${i}`,
      name: `Văn Phòng Mở ${Math.floor((rooms.length+i)/2) + 1}`,
      type: 'room',
      parentId: unit.id,
      description: ''
    } as OrgUnit))
  ];

  const numFloors = Math.max(minFloors, Math.ceil(fullRooms.length / 2));
  const totalHeight = numFloors * FLOOR_HEIGHT;

  const floorRooms = Array.from({ length: numFloors }).map((_, i) => fullRooms.slice(i * 2, i * 2 + 2));

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (isOverview) { setCameraMode('hq'); setSelectedUnit(unit); }
  };

  return (
    <group position={position}>
      {/* Base */}
      <mesh position={[0,-0.4,0]} receiveShadow>
        <boxGeometry args={[BUILDING_W+5, 0.8, BUILDING_D+5]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} metalness={0.3} />
      </mesh>

      {/* Clickable ghost shell — hidden when any room is selected */}
      {!selectedUnit && (
        <mesh
          position={[0, totalHeight / 2, 0]}
          onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
          onClick={handleClick}
        >
          <boxGeometry args={[BUILDING_W + 0.5, totalHeight + 0.5, BUILDING_D + 0.5]} />
          <meshStandardMaterial
            color="#6366f1" emissive="#6366f1"
            emissiveIntensity={hovered ? 0.2 : 0.04}
            transparent opacity={0.06} side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* Corner pillars */}
      {([[-1,-1],[1,-1],[-1,1],[1,1]] as [number,number][]).map(([sx,sz],i) => (
        <mesh key={i} position={[sx*(BUILDING_W/2+0.18), totalHeight/2, sz*(BUILDING_D/2+0.18)]}>
          <boxGeometry args={[0.12, totalHeight, 0.12]} />
          <meshStandardMaterial color={buildingColor} emissive={buildingColor} emissiveIntensity={hovered?1.2:0.45} />
        </mesh>
      ))}

      {floorRooms.map((fRooms, fi) => (
        <FloorSlab key={fi} rooms={fRooms} allEmployees={allEmployees}
          floorY={fi * FLOOR_HEIGHT + 0.11} buildingPos={position} buildingColor={buildingColor} />
      ))}

      {/* Roof */}
      <mesh position={[0, totalHeight + 0.22, 0]}>
        <boxGeometry args={[BUILDING_W + 0.6, 0.45, BUILDING_D + 0.6]} />
        <meshStandardMaterial color={buildingColor} emissive={buildingColor}
          emissiveIntensity={hovered ? 0.9 : 0.35} roughness={0.2} metalness={0.6} />
      </mesh>

      {/* ===== BẢNG HIỆU — đặt TRƯỚC tòa nhà, tách biệt hoàn toàn ===== */}
      {!selectedUnit && (
        <Html
          position={[0, totalHeight / 2 + 1, BUILDING_D / 2 + 5]}
          center
          distanceFactor={25}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            {/* Tag nhỏ: loại tòa nhà */}
            <div style={{
              background: buildingColor,
              color: 'white', padding: '3px 14px', borderRadius: 20,
              fontSize: 10, fontWeight: 900, fontFamily: 'Inter, sans-serif',
              letterSpacing: '0.15em', textTransform: 'uppercase',
              boxShadow: `0 0 18px ${buildingColor}80`,
            }}>{label}</div>
            {/* Tên văn phòng lớn */}
            <div style={{
              background: 'rgba(6,10,24,0.92)',
              border: `1px solid ${buildingColor}88`,
              color: 'white', padding: '6px 20px', borderRadius: 14,
              fontSize: 16, fontWeight: 900, fontFamily: 'Inter, sans-serif',
              letterSpacing: '0.04em', whiteSpace: 'nowrap',
              backdropFilter: 'blur(8px)',
              boxShadow: `0 4px 24px ${buildingColor}44`,
            }}>{unit.name}</div>
          </div>
        </Html>
      )}

      {isOverview && hovered && (
        <Html position={[0, -1.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: `${buildingColor}ee`, color: 'white',
            padding: '4px 14px', borderRadius: 20,
            fontSize: 11, fontWeight: 700, fontFamily: 'Inter, sans-serif',
          }}>Click để xem chi tiết</div>
        </Html>
      )}
    </group>
  );
};

export default HQBuilding;
