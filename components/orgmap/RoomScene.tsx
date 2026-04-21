// @ts-nocheck
/**
 * RoomScene — Dedicated full-screen 3D room scene.
 * Renders ONLY when user clicks into a room. Completely isolated from the building Canvas.
 */
import React, { Suspense, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';

/* ── Room dimensions ─────────────────────────────────────────────────────── */
const RW   = 20;   // width  (-RW/2 … +RW/2)
const RD   = 16;   // depth  (-RD/2 … +RD/2)
const RH   = 4.2;  // height
const WT   = 0.2;  // wall thickness
const DW   = 3.0;  // door width
const DH   = 3.2;  // door height

/* ── Accent colors ──────────────────────────────────────────────────────── */
const ROOM_COLORS: Record<string, string> = {
  'Phòng Hành chính nhân sự': '#6366f1',
  'Phòng Kế toán':            '#0ea5e9',
  'Phòng trợ lý TGĐ':         '#8b5cf6',
  'Phòng Thiết kế đấu thầu':  '#f97316',
  'Phòng Thi công':            '#10b981',
  'Phòng vật tư':              '#f59e0b',
};
const DEF_COLOR = '#64748b';
const PERSON_COLORS = ['#6366f1','#0ea5e9','#8b5cf6','#f97316','#10b981','#ec4899','#f59e0b'];

/* ═══════════════════════ FURNITURE PRIMITIVES ═══════════════════════════ */

/* ── Individual Desk ──────────────────────────────────── */
const Desk: React.FC<{ pos: [number,number,number]; rot?: number }> = ({ pos, rot = 0 }) => (
  <group position={pos} rotation={[0, rot, 0]}>
    {/* Surface */}
    <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.7, 0.07, 1.0]} />
      <meshStandardMaterial color="#8B6343" roughness={0.35} />
    </mesh>
    {/* Legs */}
    {([[-0.75,-0.46],[ 0.75,-0.46],[-0.75, 0.46],[ 0.75, 0.46]] as [number,number][]).map(([lx,lz],i) => (
      <mesh key={i} position={[lx, 0.16, lz]}>
        <boxGeometry args={[0.07, 0.44, 0.07]} />
        <meshStandardMaterial color="#5a3e28" />
      </mesh>
    ))}
    {/* Monitor */}
    <mesh position={[0, 0.76, -0.40]}>
      <boxGeometry args={[0.78, 0.50, 0.04]} />
      <meshStandardMaterial color="#0f172a" emissive="#1e3a5f" emissiveIntensity={0.55} metalness={0.8} />
    </mesh>
    <mesh position={[0, 0.43, -0.40]}>
      <boxGeometry args={[0.09, 0.16, 0.09]} />
      <meshStandardMaterial color="#1e293b" metalness={0.6} />
    </mesh>
    {/* Keyboard */}
    <mesh position={[0, 0.42, -0.05]}>
      <boxGeometry args={[0.52, 0.02, 0.22]} />
      <meshStandardMaterial color="#1e293b" metalness={0.3} />
    </mesh>
    {/* Chair */}
    <mesh position={[0, 0.18, 0.72]} castShadow>
      <boxGeometry args={[0.75, 0.08, 0.74]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.54, 1.06]}>
      <boxGeometry args={[0.73, 0.56, 0.07]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
    {([[-0.3, 0.60],[ 0.3, 0.60],[-0.3, 0.84],[ 0.3, 0.84]] as [number,number][]).map(([lx,lz],i) => (
      <mesh key={i} position={[lx, 0.08, lz]}>
        <cylinderGeometry args={[0.025, 0.025, 0.22, 6]} />
        <meshStandardMaterial color="#334155" metalness={0.5} />
      </mesh>
    ))}
  </group>
);

/* ── Desk Cluster (4 people facing each other) ──────── */
const DeskCluster: React.FC<{ pos: [number,number,number] }> = ({ pos }) => (
  <group position={pos}>
    <Desk pos={[-0.9, 0,  0.6]} rot={0} />
    <Desk pos={[ 0.9, 0,  0.6]} rot={0} />
    <Desk pos={[-0.9, 0, -0.6]} rot={Math.PI} />
    <Desk pos={[ 0.9, 0, -0.6]} rot={Math.PI} />
    {/* Central partition */}
    <mesh position={[0, 0.72, 0]}>
      <boxGeometry args={[2.1, 1.44, 0.07]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.5} metalness={0.3} />
    </mesh>
  </group>
);

/* ── Meeting table (rectangular) with chairs around ── */
const MeetingTable: React.FC<{ pos: [number,number,number]; seats?: number }> = ({ pos, seats = 8 }) => (
  <group position={pos}>
    <mesh position={[0, 0.40, 0]} castShadow>
      <boxGeometry args={[5.2, 0.1, 2.6]} />
      <meshStandardMaterial color="#7c5c3e" roughness={0.3} />
    </mesh>
    {([[-1.6,-1.1],[1.6,-1.1]] as [number,number][]).map(([lx,lz],i) => (
      <mesh key={i} position={[lx, 0.18, lz]}>
        <cylinderGeometry args={[0.13, 0.09, 0.46, 8]} />
        <meshStandardMaterial color="#4b3016" metalness={0.4} />
      </mesh>
    ))}
    {Array.from({ length: Math.min(seats, 12) }).map((_, i) => {
      const half = Math.ceil(seats / 2);
      const side = i < half ? 1 : -1;
      const col  = i < half ? i : i - half;
      const tx   = -2.0 + col * (4.0 / Math.max(half - 1, 1));
      const tz   = side * 2.0;
      return (
        <group key={i} position={[tx, 0, tz]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          <mesh position={[0, 0.18, 0]}>
            <boxGeometry args={[0.60, 0.08, 0.60]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.48, -0.34]}>
            <boxGeometry args={[0.58, 0.50, 0.07]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
        </group>
      );
    })}
  </group>
);

/* ── Filing cabinet ──────────────────────────────────── */
const FilingCabinet: React.FC<{ pos: [number,number,number] }> = ({ pos }) => (
  <group position={pos}>
    <mesh position={[0, 0.66, 0]} castShadow>
      <boxGeometry args={[0.88, 1.32, 0.56]} />
      <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.5} />
    </mesh>
    {([0.53, 0.20, -0.13, -0.46] as number[]).map((dy, i) => (
      <React.Fragment key={i}>
        <mesh position={[0, 0.66+dy, 0.285]}>
          <boxGeometry args={[0.74, 0.28, 0.02]} />
          <meshStandardMaterial color="#1e293b" metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.66+dy, 0.300]}>
          <boxGeometry args={[0.17, 0.04, 0.04]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
        </mesh>
      </React.Fragment>
    ))}
  </group>
);

/* ── Bookshelf ───────────────────────────────────────── */
const BOOK_COLORS = ['#6366f1','#0ea5e9','#10b981','#f97316','#ec4899','#8b5cf6','#f59e0b','#06b6d4','#ef4444','#84cc16'];
const Bookshelf: React.FC<{ pos: [number,number,number]; accentColor?: string }> = ({ pos, accentColor = '#6366f1' }) => (
  <group position={pos}>
    <mesh position={[0, 1.0, 0]} castShadow>
      <boxGeometry args={[2.0, 2.0, 0.42]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
    {([1.76, 1.28, 0.80, 0.32] as number[]).map((sh, ri) => (
      <mesh key={ri} position={[0, sh, 0.04]}>
        <boxGeometry args={[1.92, 0.04, 0.36]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
    ))}
    {([1.52, 1.04, 0.56] as number[]).map((sh, si) =>
      Array.from({ length: 9 }).map((_, bi) => (
        <mesh key={`${si}-${bi}`} position={[-0.86 + bi*0.20, sh, 0.12 + (bi%2)*0.04]}>
          <boxGeometry args={[0.14, 0.36 + (bi%3)*0.06, 0.20]} />
          <meshStandardMaterial color={BOOK_COLORS[(si*3+bi) % BOOK_COLORS.length]} roughness={0.6} />
        </mesh>
      ))
    )}
  </group>
);

/* ── Plant ───────────────────────────────────────────── */
const Plant: React.FC<{ pos: [number,number,number]; scale?: number; type?: 'tree'|'bush'|'cactus' }> =
  ({ pos, scale = 1, type = 'tree' }) => (
  <group position={pos} scale={[scale, scale, scale]}>
    <mesh position={[0, 0.22, 0]}>
      <cylinderGeometry args={[0.28, 0.20, 0.44, 10]} />
      <meshStandardMaterial color="#92400e" roughness={0.8} />
    </mesh>
    <mesh position={[0, 0.46, 0]}>
      <cylinderGeometry args={[0.26, 0.26, 0.07, 10]} />
      <meshStandardMaterial color="#78350f" roughness={0.9} />
    </mesh>
    {type === 'tree' && (
      <>
        <mesh position={[0, 0.88, 0]}>
          <cylinderGeometry args={[0.07, 0.10, 0.84, 8]} />
          <meshStandardMaterial color="#713f12" roughness={0.9} />
        </mesh>
        {([[0,1.62,0,.54],[-.29,1.38,.21,.37],[.29,1.38,-.21,.37],[-.20,1.68,-.19,.31],[.19,1.68,.19,.31]] as [number,number,number,number][])
          .map(([lx,ly,lz,lr],i) => (
          <mesh key={i} position={[lx,ly,lz]}>
            <sphereGeometry args={[lr,12,12]} />
            <meshStandardMaterial color={i===0?'#15803d':'#16a34a'} roughness={0.8} />
          </mesh>
        ))}
      </>
    )}
    {type === 'bush' && (
      ([[0,.74,0,.56],[-.31,.62,.16,.39],[.31,.62,-.16,.39],[0,.82,-.22,.35]] as [number,number,number,number][])
        .map(([lx,ly,lz,lr],i) => (
        <mesh key={i} position={[lx,ly,lz]}>
          <sphereGeometry args={[lr,10,10]} />
          <meshStandardMaterial color={i%2===0?'#15803d':'#4ade80'} roughness={0.8} />
        </mesh>
      ))
    )}
    {type === 'cactus' && (
      <>
        <mesh position={[0, 1.02, 0]}>
          <cylinderGeometry args={[0.19, 0.23, 1.12, 8]} />
          <meshStandardMaterial color="#4d7c0f" roughness={0.8} />
        </mesh>
        <mesh position={[-0.30, 0.82, 0]} rotation={[0,0, Math.PI/3]}>
          <cylinderGeometry args={[0.11, 0.13, 0.62, 8]} />
          <meshStandardMaterial color="#4d7c0f" roughness={0.8} />
        </mesh>
        <mesh position={[0.28, 0.96, 0]} rotation={[0,0,-Math.PI/4]}>
          <cylinderGeometry args={[0.09, 0.11, 0.48, 8]} />
          <meshStandardMaterial color="#4d7c0f" roughness={0.8} />
        </mesh>
      </>
    )}
  </group>
);

/* ═════════════════════ ROOM STRUCTURE ══════════════════════════════════ */
const RoomStructure: React.FC<{ accent: string; name: string; lights: boolean }> = ({ accent, name, lights }) => (
  <>
    {/* Floor */}
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[RW, RD]} />
      <meshStandardMaterial color="#1e293b" roughness={0.85} />
    </mesh>
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[RW - 2, RD - 2]} />
      <meshStandardMaterial color={accent} transparent opacity={0.07} roughness={1} />
    </mesh>

    {/* Back wall */}
    <mesh position={[0, RH/2, -RD/2]} receiveShadow castShadow>
      <boxGeometry args={[RW, RH, WT]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>
    {/* Left wall */}
    <mesh position={[-RW/2, RH/2, 0]}>
      <boxGeometry args={[WT, RH, RD]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>
    {/* Right wall */}
    <mesh position={[RW/2, RH/2, 0]}>
      <boxGeometry args={[WT, RH, RD]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>

    {/* Front wall — left of door */}
    <mesh position={[-(DW/2 + (RW/2 - DW/2)/2), RH/2, RD/2]}>
      <boxGeometry args={[RW/2 - DW/2, RH, WT]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>
    {/* Front wall — right of door */}
    <mesh position={[(DW/2 + (RW/2 - DW/2)/2), RH/2, RD/2]}>
      <boxGeometry args={[RW/2 - DW/2, RH, WT]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>
    {/* Front wall — lintel above door */}
    <mesh position={[0, DH + (RH - DH)/2, RD/2]}>
      <boxGeometry args={[DW + WT*2, RH - DH, WT]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>

    {/* Ceiling */}
    <mesh position={[0, RH, 0]}>
      <boxGeometry args={[RW, WT, RD]} />
      <meshStandardMaterial color="#1e293b" roughness={0.9} transparent opacity={0.5} />
    </mesh>

    {/* ── Door Frame ── */}
    <mesh position={[-DW/2 - 0.09, DH/2, RD/2]}>
      <boxGeometry args={[0.18, DH, 0.24]} />
      <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
    </mesh>
    <mesh position={[DW/2 + 0.09, DH/2, RD/2]}>
      <boxGeometry args={[0.18, DH, 0.24]} />
      <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
    </mesh>
    <mesh position={[0, DH + 0.11, RD/2]}>
      <boxGeometry args={[DW + 0.4, 0.22, 0.24]} />
      <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
    </mesh>

    {/* ── Door Panel (30° open) ── */}
    <group position={[-DW/2 + 0.09, 0, RD/2 - 0.10]} rotation={[0, -Math.PI/5.5, 0]}>
      <mesh position={[DW/2 - 0.10, DH/2, 0]} castShadow>
        <boxGeometry args={[DW - 0.20, DH - 0.10, 0.08]} />
        <meshStandardMaterial color="#1e40af" transparent opacity={0.65} metalness={0.3} roughness={0.05} />
      </mesh>
      {/* handle */}
      <mesh position={[DW - 0.40, DH/2 - 0.10, 0.07]} rotation={[Math.PI/2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.22, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>

    {/* ── Door label above frame ── */}
    <Html position={[0, DH + 0.68, RD/2 + 0.1]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <div style={{
        background: 'rgba(6,10,24,0.96)', border: `2px solid ${accent}`,
        borderRadius: 11, padding: '5px 18px', color: 'white',
        fontSize: 13, fontWeight: 900, fontFamily: 'Inter, sans-serif',
        whiteSpace: 'nowrap', letterSpacing: '0.03em',
        boxShadow: `0 0 22px ${accent}66`,
      }}>{name}</div>
    </Html>

    {/* ── Ceiling lights ── */}
    {([[-4.5, RH-0.07, -3.5], [4.5, RH-0.07, -3.5], [0, RH-0.07, 0],
       [-4.5, RH-0.07, 4.5], [4.5, RH-0.07, 4.5]] as [number,number,number][]).map((lp, i) => (
      <mesh key={i} position={lp}>
        <boxGeometry args={[1.3, 0.06, 0.42]} />
        <meshStandardMaterial
          color={lights ? '#ffffff' : '#334155'}
          emissive={lights ? '#fff8e8' : '#000000'}
          emissiveIntensity={lights ? 2.5 : 0}
        />
      </mesh>
    ))}

    {/* ── Accent skirting / baseboard glows ── */}
    {([
      [[0, 0.07, -RD/2+WT+0.01], [RW-WT, 0.14, WT]],
      [[-RW/2+WT+0.01, 0.07, 0],   [WT, 0.14, RD]],
      [[RW/2-WT-0.01, 0.07, 0],    [WT, 0.14, RD]],
    ] as [[number,number,number],[number,number,number]][]).map(([p, s], i) => (
      <mesh key={i} position={p}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
      </mesh>
    ))}

    {/* ── Whiteboard back wall ── */}
    <mesh position={[-2.5, 2.0, -RD/2 + WT + 0.05]}>
      <boxGeometry args={[4.5, 2.6, 0.06]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.95} />
    </mesh>

    {/* ── Wall-mounted TV right wall ── */}
    <mesh position={[RW/2 - WT - 0.06, 2.1, -2.0]} rotation={[0, -Math.PI/2, 0]}>
      <boxGeometry args={[3.8, 2.2, 0.08]} />
      <meshStandardMaterial color="#0f172a" emissive="#0ea5e9" emissiveIntensity={lights ? 0.45 : 0.1} metalness={0.8} />
    </mesh>
  </>
);

/* ═════════════════════ PERSON AVATAR ═══════════════════════════════════ */
const PersonAvatar: React.FC<{ emp: Employee; pos: [number,number,number] }> = ({ emp, pos }) => {
  const { setSelectedEmployee } = useOrgMapStore();
  const [hov, setHov] = useState(false);
  const ref = useRef<THREE.Group>(null!);
  const col = PERSON_COLORS[emp.fullName.charCodeAt(0) % PERSON_COLORS.length];

  useFrame(() => {
    if (!ref.current) return;
    const g = hov ? 1.2 : 1.0;
    ref.current.scale.lerp(new THREE.Vector3(g,g,g), 0.15);
  });

  return (
    <group ref={ref} position={pos}>
      <mesh
        onPointerOver={e => { e.stopPropagation(); setHov(true); document.body.style.cursor='pointer'; }}
        onPointerOut={() => { setHov(false); document.body.style.cursor='default'; }}
        onClick={e => { e.stopPropagation(); setSelectedEmployee(emp); }}
      >
        <cylinderGeometry args={[0.20, 0.24, 0.60, 12]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={hov ? 0.7 : 0.2} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.50, 0]}>
        <sphereGeometry args={[0.22, 14, 14]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={hov ? 0.5 : 0.1} roughness={0.3} />
      </mesh>
      <Html position={[0, 0.88, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{
          background: hov ? `${col}ee` : 'rgba(6,10,24,0.88)',
          color: 'white', padding: '1px 6px', borderRadius: 7,
          fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap',
          fontFamily: 'Inter, sans-serif', border: `1px solid ${col}55`,
          boxShadow: hov ? `0 0 8px ${col}66` : 'none',
        }}>
          {emp.fullName.split(' ').pop()}
        </div>
      </Html>
      {hov && (
        <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.32, 0]}>
          <ringGeometry args={[0.28, 0.40, 24]} />
          <meshBasicMaterial color={col} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};

/* ═════════════════════ ROOM INTERIOR LAYOUT ════════════════════════════ */
const DESK_SEATS: [number,number,number][] = [
  [-6.2, 0.62,  1.5], [-3.8, 0.62,  1.5],   // cluster front-left desk L & R
  [-6.2, 0.62, -0.1], [-3.8, 0.62, -0.1],   // cluster front-left (back desks)
  [-6.2, 0.62, -3.4], [-3.8, 0.62, -3.4],   // cluster back-left
];

const RoomInterior: React.FC<{ room: OrgUnit; employees: Employee[]; lights: boolean }> = ({ room, employees, lights }) => {
  const accent = ROOM_COLORS[room.name] ?? DEF_COLOR;
  return (
    <>
      {/* Lighting */}
      {/* Cường độ ánh sáng được đẩy lên rất lớn để làm căn phòng sáng rõ */}
      <ambientLight intensity={lights ? 1.2 : 0.2} color="#9cb1d9" />
      <directionalLight
        position={[10, 14, 12]} intensity={lights ? 1.8 : 0.3}
        color="#ffffff" castShadow shadow-mapSize={[1024,1024]}
        shadow-camera-far={80} shadow-camera-top={20} shadow-camera-bottom={-20}
        shadow-camera-left={-25} shadow-camera-right={25}
      />
      {lights && (
        <>
          <pointLight position={[-4.5, 4.0, -3.5]} intensity={1.8} color="#fffcf0" distance={16} decay={1.5} />
          <pointLight position={[ 4.5, 4.0, -3.5]} intensity={1.8} color="#fffcf0" distance={16} decay={1.5} />
          <pointLight position={[ 0.0, 4.0,  0.0]} intensity={1.8} color="#fffcf0" distance={16} decay={1.5} />
          <pointLight position={[-4.5, 4.0,  4.5]} intensity={1.8} color="#fffcf0" distance={16} decay={1.5} />
          <pointLight position={[ 4.5, 4.0,  4.5]} intensity={1.8} color="#fffcf0" distance={16} decay={1.5} />
        </>
      )}
      {/* Accent glow from baseboard */}
      <pointLight position={[0, 0.2, -RD/2 + 0.5]} intensity={0.8} color={accent} distance={12} decay={2} />

      {/* Structure (walls, floor, ceiling, door) */}
      <RoomStructure accent={accent} name={room.name} lights={lights} />

      {/* ── Desk clusters (left side) ── */}
      <DeskCluster pos={[-5.0, 0,  0.6]} />
      <DeskCluster pos={[-5.0, 0, -3.8]} />

      {/* ── Individual desks (center-right) ── */}
      <Desk pos={[0.8, 0, 2.8]} rot={Math.PI} />
      <Desk pos={[0.8, 0, 5.0]} rot={Math.PI} />

      {/* ── Meeting table (right-back area) ── */}
      <MeetingTable pos={[5.0, 0, -3.5]} seats={8} />

      {/* ── Storage back-right corner ── */}
      <FilingCabinet pos={[8.5,  0, -6.0]} />
      <FilingCabinet pos={[7.3,  0, -6.0]} />

      {/* ── Bookshelves right wall ── */}
      <Bookshelf pos={[8.7, 0,  0.0]} accentColor={accent} />
      <Bookshelf pos={[8.7, 0, -3.2]} accentColor={accent} />

      {/* ── Reception / front desk ── */}
      <mesh position={[5.5, 0.50, 6.0]} castShadow>
        <boxGeometry args={[4.2, 1.0, 1.0]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[5.5, 1.02, 6.0]}>
        <boxGeometry args={[4.2, 0.06, 1.1]} />
        <meshStandardMaterial color="#334155" roughness={0.3} metalness={0.5} />
      </mesh>
      <Desk pos={[5.5, 0, 4.8]} rot={Math.PI} />

      {/* ── Plants ── */}
      <Plant pos={[-8.8, 0,  7.0]} scale={1.2} type="tree" />
      <Plant pos={[ 8.6, 0,  7.0]} scale={1.0} type="bush" />
      <Plant pos={[-8.8, 0, -5.8]} scale={0.9} type="cactus" />
      <Plant pos={[ 0.0, 0, -7.2]} scale={1.3} type="tree" />
      <Plant pos={[ 3.5, 0,  3.2]} scale={0.8} type="bush" />
      <Plant pos={[-2.0, 0,  5.5]} scale={0.7} type="cactus" />

      {/* ── Employees at desks ── */}
      {employees.slice(0, 6).map((emp, i) => (
        <PersonAvatar key={emp.id} emp={emp} pos={DESK_SEATS[i] ?? [0, 0.62, 0]} />
      ))}
    </>
  );
};

/* ═════════════════════ MAIN EXPORT ════════════════════════════════════ */
interface RoomSceneProps {
  room: OrgUnit;
  employees: Employee[];
  onBack: () => void;
}

const RoomScene: React.FC<RoomSceneProps> = ({ room, employees, onBack }) => {
  const [lights, setLights] = useState(true);
  const accent = ROOM_COLORS[room.name] ?? DEF_COLOR;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050a14', borderRadius: 16, overflow: 'hidden' }}>

      {/* ── 3D Canvas ── */}
      <Canvas
        camera={{ position: [18, 16, 22], fov: 44, near: 0.1, far: 300 }}
        gl={{ antialias: true }}
        shadows
        style={{ background: 'linear-gradient(180deg, #050a14 0%, #0a1628 100%)' }}
      >
        <fog attach="fog" args={['#050a14', 40, 120]} />
        <Suspense fallback={null}>
          <RoomInterior room={room} employees={employees} lights={lights} />
        </Suspense>
        <OrbitControls
          target={[0, 1.5, 0]}
          minDistance={8}
          maxDistance={50}
          maxPolarAngle={Math.PI / 2.05}
          enableDamping
          dampingFactor={0.07}
          rotateSpeed={0.7}
          zoomSpeed={0.9}
          panSpeed={0.9}
        />
      </Canvas>

      {/* ── Back button ── */}
      <button
        onClick={onBack}
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 40,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 20px',
          background: 'rgba(10,15,30,0.90)',
          border: `1px solid ${accent}55`,
          borderRadius: 14, cursor: 'pointer',
          color: 'white', fontSize: 13, fontWeight: 700,
          fontFamily: 'Inter, sans-serif',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = `${accent}33`)}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(10,15,30,0.90)')}
      >
        ← Về tòa nhà
      </button>

      {/* ── Room title ── */}
      <div style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 40, display: 'flex', alignItems: 'center', gap: 10,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(6,10,24,0.94)',
          border: `1px solid ${accent}66`,
          padding: '8px 24px', borderRadius: 16,
          color: 'white', fontSize: 15, fontWeight: 900,
          fontFamily: 'Inter, sans-serif',
          backdropFilter: 'blur(12px)',
          boxShadow: `0 0 30px ${accent}44`,
          whiteSpace: 'nowrap',
        }}>
          {room.name}
        </div>
        {employees.length > 0 && (
          <div style={{
            background: accent, width: 30, height: 30, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 900, color: 'white',
            fontFamily: 'Inter, sans-serif',
            boxShadow: `0 0 16px ${accent}88`,
          }}>
            {employees.length}
          </div>
        )}
      </div>

      {/* ── Light toggle ── */}
      <button
        onClick={() => setLights(l => !l)}
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 40,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 18px',
          background: lights ? `${accent}22` : 'rgba(10,15,30,0.90)',
          border: `1px solid ${lights ? accent : 'rgba(255,255,255,0.12)'}`,
          borderRadius: 14, cursor: 'pointer',
          color: lights ? 'white' : '#64748b',
          fontSize: 12, fontWeight: 700, fontFamily: 'Inter, sans-serif',
          backdropFilter: 'blur(12px)',
          transition: 'all 0.25s',
        }}
      >
        {lights ? '💡 Đèn bật' : '🌑 Đèn tắt'}
      </button>

      {/* ── Employee list ── */}
      {employees.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: 16, zIndex: 40,
          background: 'rgba(6,10,24,0.92)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 16, padding: '12px 16px',
          backdropFilter: 'blur(12px)',
          minWidth: 200, maxWidth: 240,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#64748b',
            fontFamily: 'Inter, sans-serif',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 8,
          }}>
            Nhân viên phòng ({employees.length})
          </div>
          {employees.map(emp => (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: PERSON_COLORS[emp.fullName.charCodeAt(0) % PERSON_COLORS.length],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900, color: 'white',
                fontFamily: 'Inter, sans-serif', flexShrink: 0,
              }}>
                {emp.fullName.charAt(0)}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'white', fontFamily: 'Inter, sans-serif' }}>
                  {emp.fullName.split(' ').slice(-2).join(' ')}
                </div>
                <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'Inter, sans-serif' }}>
                  {(emp as any).title || 'Nhân viên'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Controls hint ── */}
      <div style={{
        position: 'absolute', bottom: 20, right: 16, zIndex: 40,
        fontSize: 10, color: '#475569', fontFamily: 'Inter, sans-serif',
        textAlign: 'right', pointerEvents: 'none', lineHeight: 1.6,
      }}>
        🖱 Kéo để xoay<br />⚲ Scroll để zoom
      </div>
    </div>
  );
};

export default RoomScene;
