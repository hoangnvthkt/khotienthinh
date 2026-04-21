// @ts-nocheck
import React, { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrgUnit, Employee } from '../../types';
import { useOrgMapStore } from './useOrgMapStore';
import CameraController from './CameraController';
import HQBuilding from './HQBuilding';
import BranchNode from './BranchNode';
import ConnectionLine from './ConnectionLine';

/* Layout positions in world space — wider to clear the bigger HQ building */
const HQ_POS: [number, number, number] = [0, 0, 0];
const BRANCH_POSITIONS: Record<string, [number, number, number]> = {
  factory:           [-50, 0, 10],
  branch_hanoi:      [ 50, 0, 10],
  construction_site: [  0, 0, -55],
};

/* Map OrgUnit.type → position key */
function getBranchPosKey(unit: OrgUnit, index: number): [number, number, number] {
  if (unit.type === 'factory') return BRANCH_POSITIONS.factory;
  if (unit.type === 'construction_site') return BRANCH_POSITIONS.construction_site;
  const nameLower = unit.name.toLowerCase();
  if (nameLower.includes('hà nội') || nameLower.includes('ha noi') || nameLower.includes('hanoi')) return BRANCH_POSITIONS.branch_hanoi;
  // For custom / department at branch level — spread horizontally
  const x = index % 2 === 0 ? 26 : -26;
  return [x, 0, (Math.floor(index / 2)) * 16 + 6];
}

interface Scene3DProps {
  orgUnits: OrgUnit[];
  employees: Employee[];
}

/* ─── STANDALONE ROOM NODE (for factory/single-unit branches) ─── */
/* Furniture */
const SRNDesk: React.FC<{ position: [number,number,number]; rot?: number }> = ({ position, rot=0 }) => (
  <group position={position} rotation={[0,rot,0]}>
    <mesh position={[0,0.3,0]} castShadow>
      <boxGeometry args={[1.4,0.07,0.9]} />
      <meshStandardMaterial color="#8B6343" roughness={0.4} />
    </mesh>
    {([[-0.6,-0.35],[0.6,-0.35],[-0.6,0.35],[0.6,0.35]] as [number,number][]).map(([lx,lz],i)=>(
      <mesh key={i} position={[lx,0.12,lz]}>
        <boxGeometry args={[0.06,0.42,0.06]} />
        <meshStandardMaterial color="#5a3e28" />
      </mesh>
    ))}
    <mesh position={[0,0.62,-0.32]}>
      <boxGeometry args={[0.7,0.44,0.04]} />
      <meshStandardMaterial color="#0f172a" emissive="#1e3a5f" emissiveIntensity={0.5} metalness={0.8} />
    </mesh>
    <mesh position={[0,0.14,0.65]}>
      <boxGeometry args={[0.66,0.08,0.62]} />
      <meshStandardMaterial color="#1e293b" roughness={0.7} />
    </mesh>
  </group>
);

const SRNCluster: React.FC<{ position: [number,number,number] }> = ({ position }) => (
  <group position={position}>
    <SRNDesk position={[-0.8,0,0.55]} rot={0} />
    <SRNDesk position={[0.8,0,0.55]} rot={0} />
    <SRNDesk position={[-0.8,0,-0.55]} rot={Math.PI} />
    <SRNDesk position={[0.8,0,-0.55]} rot={Math.PI} />
    <mesh position={[0,0.4,0]}>
      <boxGeometry args={[1.72,0.55,0.06]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.45} />
    </mesh>
  </group>
);

const SRNPerson: React.FC<{ emp: Employee; pos: [number,number,number] }> = ({ emp, pos }) => {
  const { setSelectedEmployee } = useOrgMapStore();
  const [hov, setHov] = useState(false);
  const ref = useRef<THREE.Mesh>(null!);
  const COLORS = ['#6366f1','#0ea5e9','#8b5cf6','#f97316','#10b981','#ec4899','#f59e0b'];
  const color = COLORS[emp.fullName.charCodeAt(0) % COLORS.length];
  const initial = emp.fullName.charAt(0).toUpperCase();
  useFrame(() => {
    if (!ref.current) return;
    const g = hov ? 1.25 : 1.0;
    ref.current.scale.lerp(new THREE.Vector3(g,g,g), 0.15);
  });
  return (
    <group position={pos}>
      <mesh ref={ref}
        onPointerOver={e=>{e.stopPropagation();setHov(true);document.body.style.cursor='pointer';}}
        onPointerOut={()=>{setHov(false);document.body.style.cursor='default';}}
        onClick={e=>{e.stopPropagation();setSelectedEmployee(emp);}}
      >
        <cylinderGeometry args={[0.17,0.21,0.52,10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hov?0.7:0.2} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0,0.42,0]}>
        <sphereGeometry args={[0.19,12,12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hov?0.5:0.12} roughness={0.3} />
      </mesh>
      <Text position={[0,0.42,0.2]} fontSize={0.16} color="white" anchorX="center" anchorY="middle">{initial}</Text>
      <Html position={[0,0.74,0]} center distanceFactor={8} style={{pointerEvents:'none',userSelect:'none'}}>
        <div style={{background:hov?`${color}ee`:'rgba(6,10,24,0.85)',color:'white',padding:'1px 5px',borderRadius:7,fontSize:8,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Inter,sans-serif',border:`1px solid ${color}44`}}>
          {emp.fullName.split(' ').pop()}
        </div>
      </Html>
    </group>
  );
};

/* Main standalone room component */
const FACTORY_COLOR = '#8b5cf6';
const SRN_W = 15; const SRN_D = 10; const SRN_H = 3.8;
const SRN_CLUSTERS: [number,number,number][] = [[-4.5,0,3.0],[1.8,0,3.0],[-4.5,0,-1.2],[1.8,0,-1.2]];
const SRN_SEATS: [number,number,number][] = [[-0.8,0.6,0.55],[0.8,0.6,0.55],[-0.8,0.6,-0.55],[0.8,0.6,-0.55]];

const StandaloneRoomNode: React.FC<{ unit: OrgUnit; position: [number,number,number]; employees: Employee[] }> = ({ unit, position, employees }) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hov, setHov] = useState(false);
  const { setActiveRoomId } = useOrgMapStore();
  const empCount = employees.length;
  const accentColor = FACTORY_COLOR;

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity += ((hov ? 0.3 : 0.05) - mat.emissiveIntensity) * 0.1;
  });

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    setActiveRoomId(unit.id);
  }, [unit.id, setActiveRoomId]);

  return (
    <group position={position}>
      {/* Base platform */}
      <mesh position={[0,-SRN_H/2-0.4,0]} receiveShadow>
        <boxGeometry args={[SRN_W+6,0.8,SRN_D+6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} metalness={0.3} />
      </mesh>

      {/* Walls */}
      <mesh ref={meshRef}
        onPointerOver={e=>{e.stopPropagation();setHov(true);document.body.style.cursor='pointer';}}
        onPointerOut={()=>{setHov(false);document.body.style.cursor='default';}}
        onClick={handleClick} castShadow receiveShadow
      >
        <boxGeometry args={[SRN_W,SRN_H,SRN_D]} />
        <meshStandardMaterial color="#0f1829" emissive={accentColor} emissiveIntensity={0.05}
          transparent opacity={0.65} roughness={0.08} metalness={0.3} depthWrite={false} />
      </mesh>

      {/* Top accent bar */}
      <mesh position={[0,SRN_H/2+0.06,0]}>
        <boxGeometry args={[SRN_W+0.08,0.12,SRN_D+0.08]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={hov?2.2:0.9} />
      </mesh>

      {/* Roof slab */}
      <mesh position={[0,SRN_H/2+0.3,0]}>
        <boxGeometry args={[SRN_W+0.6,0.45,SRN_D+0.6]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor}
          emissiveIntensity={hov?0.9:0.35} roughness={0.2} metalness={0.6} />
      </mesh>

      {/* Corner pillars */}
      {([[-1,-1],[1,-1],[-1,1],[1,1]] as [number,number][]).map(([sx,sz],i)=>(
        <mesh key={i} position={[sx*(SRN_W/2+0.18),0,sz*(SRN_D/2+0.18)]}>
          <boxGeometry args={[0.12,SRN_H+0.6,0.12]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={hov?1.2:0.45} />
        </mesh>
      ))}

      {/* Floor */}
      <mesh position={[0,-SRN_H/2+0.02,0]} receiveShadow>
        <planeGeometry args={[SRN_W-0.2,SRN_D-0.2]} />
        <meshStandardMaterial color={accentColor} transparent opacity={0.08} roughness={1} />
      </mesh>

      {/* Furniture */}
      {SRN_CLUSTERS.slice(0, Math.max(2, Math.ceil(empCount/4))).map((cp,i)=>(
        <SRNCluster key={i} position={[cp[0],-SRN_H/2+0.02,cp[2]]} />
      ))}

      {/* Door frame */}
      <mesh position={[-1.5,-SRN_H/2+1.5,SRN_D/2+0.02]}>
        <boxGeometry args={[0.16,3.0,0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[1.5,-SRN_H/2+1.5,SRN_D/2+0.02]}>
        <boxGeometry args={[0.16,3.0,0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0,-SRN_H/2+3.1,SRN_D/2+0.02]}>
        <boxGeometry args={[3.2,0.2,0.18]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Door panel ajar */}
      <group position={[-1.4,-SRN_H/2,SRN_D/2]} rotation={[0,-Math.PI/7,0]}>
        <mesh position={[1.35,1.5,0.05]}>
          <boxGeometry args={[2.7,2.9,0.07]} />
          <meshStandardMaterial color={accentColor} transparent opacity={0.55} metalness={0.3} roughness={0.05} />
        </mesh>
      </group>

      {/* Room label above door */}
      <DistanceLabel position={[0,-SRN_H/2+3.55,SRN_D/2+0.3]} maxDist={140} distanceFactor={22} center style={{pointerEvents:'none',userSelect:'none'}}>
        <div style={{background:hov?`${accentColor}dd`:'rgba(6,10,24,0.92)',color:'white',border:`1.5px solid ${accentColor}${hov?'ff':'66'}`,padding:'3px 12px',borderRadius:10,fontSize:11,fontWeight:800,whiteSpace:'nowrap',fontFamily:'Inter,sans-serif',backdropFilter:'blur(8px)',boxShadow:hov?`0 0 16px ${accentColor}88`:'none',transition:'all 0.2s'}}>
          {unit.name}
        </div>
      </DistanceLabel>

      {/* Tag NHÀ MÁY above */}
      <DistanceLabel position={[0,SRN_H/2+2.6,0]} maxDist={140} distanceFactor={25} center style={{pointerEvents:'none',userSelect:'none'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <div style={{background:'linear-gradient(135deg,#8b5cf6,#a78bfa)',color:'white',padding:'3px 14px',borderRadius:20,fontSize:10,fontWeight:900,fontFamily:'Inter,sans-serif',letterSpacing:'0.15em',textTransform:'uppercase',boxShadow:'0 0 18px #8b5cf680'}}>NHÀ MÁY</div>
          <div style={{background:'rgba(6,10,24,0.92)',border:'1px solid rgba(139,92,246,0.5)',color:'white',padding:'5px 16px',borderRadius:14,fontSize:14,fontWeight:900,fontFamily:'Inter,sans-serif',whiteSpace:'nowrap',backdropFilter:'blur(8px)',boxShadow:'0 4px 24px rgba(139,92,246,0.3)'}}>{unit.name}</div>
        </div>
      </DistanceLabel>

      {/* Employee count badge */}
      {empCount>0 && (
        <DistanceLabel position={[SRN_W/2-0.9,SRN_H/2+0.5,0]} maxDist={100} distanceFactor={16} center style={{pointerEvents:'none'}}>
          <div style={{background:accentColor,color:'white',width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,fontFamily:'Inter,sans-serif',boxShadow:`0 0 12px ${accentColor}88`}}>{empCount}</div>
        </DistanceLabel>
      )}

      {/* Hover hint */}
      {hov && (
        <Html position={[0,-SRN_H/2-0.5,0]} center style={{pointerEvents:'none'}}>
          <div style={{background:`${accentColor}dd`,color:'white',padding:'3px 10px',borderRadius:12,fontSize:10,fontWeight:700,fontFamily:'Inter,sans-serif',whiteSpace:'nowrap'}}>
            {empCount>0?`Vào nhà máy (${empCount} NV)`:'Vào nhà máy'}
          </div>
        </Html>
      )}

      {/* Employees */}
      {employees.map((emp,i)=>{
        const ci=Math.floor(i/4)%4;
        const si=i%4;
        const base=SRN_CLUSTERS[ci]??SRN_CLUSTERS[0];
        const off=SRN_SEATS[si];
        return <SRNPerson key={emp.id} emp={emp} pos={[base[0]+off[0],-SRN_H/2+off[1],base[2]+off[2]]} />;
      })}
    </group>
  );
};

/* ─── DISTANCE-BASED LABEL: ẩn khi camera quá xa ─── */
const DistanceLabel: React.FC<{
  position: [number,number,number];
  maxDist?: number;
  distanceFactor?: number;
  center?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ position, maxDist = 110, distanceFactor = 20, center, style, children }) => {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const worldPos = useRef(new THREE.Vector3());
  const visRef = useRef(true);
  const [visible, setVisible] = useState(true);
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.getWorldPosition(worldPos.current);
    const dist = camera.position.distanceTo(worldPos.current);
    const show = dist < maxDist;
    if (show !== visRef.current) { visRef.current = show; setVisible(show); }
  });
  return (
    <group ref={groupRef} position={position}>
      {visible && <Html center={center} distanceFactor={distanceFactor} style={style}>{children}</Html>}
    </group>
  );
};




const GridFloor: React.FC = () => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
    <planeGeometry args={[200, 200, 40, 40]} />
    <meshStandardMaterial
      color="#0a0f1e"
      roughness={1}
      wireframe={false}
      transparent
      opacity={1}
    />
  </mesh>
);

const GridLines: React.FC = () => {
  const lines: JSX.Element[] = [];
  const size = 120;
  const divisions = 24;
  const step = size / divisions;
  const half = size / 2;

  for (let i = 0; i <= divisions; i++) {
    const t = -half + i * step;
    lines.push(
      <line key={`h${i}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={new Float32Array([-half, 0, t, half, 0, t])}
            count={2}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#1e293b" transparent opacity={0.5} />
      </line>,
      <line key={`v${i}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={new Float32Array([t, 0, -half, t, 0, half])}
            count={2}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#1e293b" transparent opacity={0.5} />
      </line>
    );
  }
  return <group position={[0, -0.45, 0]}>{lines}</group>;
};

const Scene3D: React.FC<Scene3DProps> = ({ orgUnits, employees }) => {
  const { setCameraMode } = useOrgMapStore();
  const orbitRef = useRef<any>(null);

  // Identify HQ unit: unit with most children (phòng ban = rooms)
  const rootUnit = orgUnits.find(u => !u.parentId && u.type === 'company');

  // HQ = unit with most child units (likely VP Hưng Yên with 6 rooms)
  const hqUnit = orgUnits.reduce<OrgUnit | null>((best, u) => {
    if (u.type === 'company') return best;
    const childCount = orgUnits.filter(c => c.parentId === u.id).length;
    if (childCount < 2) return best;
    const bestCount = best ? orgUnits.filter(c => c.parentId === best.id).length : 0;
    return childCount > bestCount ? u : best;
  }, null);

  const rooms = hqUnit ? orgUnits.filter(u => u.parentId === hqUnit.id) : [];

  // Branches = direct children of root (or top level) that are NOT HQ and NOT company
  const branches = orgUnits.filter(u =>
    u.id !== hqUnit?.id &&
    u.type !== 'company' &&
    (u.parentId === rootUnit?.id || u.parentId === hqUnit?.parentId)
  );

  // ESC key to go back
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCameraMode('overview');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setCameraMode]);

  const branchPosMap: Record<string, [number, number, number]> = {};
  branches.forEach((b, i) => {
    branchPosMap[b.id] = getBranchPosKey(b, i);
  });

  return (
    <Canvas
      camera={{ position: [0, 50, 90], fov: 52, near: 0.1, far: 2000 }}
      gl={{ antialias: true, alpha: false }}
      shadows
      style={{ background: '#050a14' }}
    >
      {/* Atmosphere */}
      <fog attach="fog" args={['#050a14', 120, 500]} />
      <Stars radius={200} depth={60} count={4000} factor={4} saturation={0} fade speed={0.4} />

      {/* Lighting */}
      <ambientLight intensity={0.5} color="#8b9dc3" />
      <directionalLight
        position={[40, 70, 40]}
        intensity={1.6}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={200}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-left={-80}
        shadow-camera-right={80}
      />
      <pointLight position={[0, 30, 0]} intensity={1.2} color="#6366f1" />
      <pointLight position={[-50, 14, 10]} intensity={0.7} color="#8b5cf6" />
      <pointLight position={[ 50, 14, 10]} intensity={0.7} color="#0ea5e9" />
      <pointLight position={[0, 14, -55]} intensity={0.7} color="#f97316" />

      {/* Camera controller */}
      <CameraController branchPositions={branchPosMap} orbitRef={orbitRef} />

      {/* Orbit controls — free after camera animation completes */}
      <OrbitControls
        ref={orbitRef}
        enablePan={true}
        panSpeed={1.2}
        minDistance={6}
        maxDistance={300}
        maxPolarAngle={Math.PI / 1.8}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={1.0}
      />

      {/* Floor grid */}
      <Suspense fallback={null}>
        <GridFloor />
        <GridLines />

        {/* HQ Building */}
        {hqUnit && (
          <>
            <HQBuilding
              unit={hqUnit}
              rooms={rooms}
              allEmployees={employees}
              position={HQ_POS}
            />
            {/* Connection lines from HQ to branches */}
            {branches.map(b => (
              <ConnectionLine
                key={b.id}
                from={[HQ_POS[0], 4, HQ_POS[2]]}
                to={[branchPosMap[b.id][0], 2, branchPosMap[b.id][2]]}
                color={b.type === 'factory' ? '#8b5cf6' : b.type === 'construction_site' ? '#f97316' : '#0ea5e9'}
              />
            ))}
          </>
        )}

        {/* Branch Nodes and other buildings */}
        {branches.map(b => {
          if (b.type === 'factory') {
            const factoryEmps = employees.filter(e => e.orgUnitId === b.id);
            return (
              <StandaloneRoomNode key={b.id} unit={b} position={branchPosMap[b.id]} employees={factoryEmps} />
            );
          }
          const nameLower = b.name.toLowerCase();
          if (nameLower.includes('hà nội') || nameLower.includes('ha noi') || nameLower.includes('hanoi')) {
            const hanoiRooms = orgUnits.filter(u => u.parentId === b.id);
            return (
              <HQBuilding
                key={b.id}
                unit={b}
                rooms={hanoiRooms}
                allEmployees={employees}
                position={branchPosMap[b.id]}
                label="CHI NHÁNH"
                minFloors={5}
                buildingColor="#0ea5e9"
              />
            );
          }
          return (
            <BranchNode
              key={b.id}
              unit={b}
              position={branchPosMap[b.id]}
              employees={employees.filter(e => e.orgUnitId === b.id)}
            />
          );
        })}
      </Suspense>
    </Canvas>
  );
};

export default Scene3D;
