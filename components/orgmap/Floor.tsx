// @ts-nocheck
import React from 'react';
import { OrgUnit, Employee } from '../../types';
import Room from './Room';

interface FloorProps {
  floorIndex: number;       // 0 = tầng 1 (thấp nhất)
  rooms: OrgUnit[];
  allEmployees: Employee[];
  floorY: number;           // Y position of this floor
  buildingWidth?: number;
  buildingDepth?: number;
  buildingWorldPos?: [number, number, number]; // HQBuilding world position
}

const FLOOR_HEIGHT = 2.6;
const ROOM_W = 5.4;
const ROOM_D = 3.8;

const Floor: React.FC<FloorProps> = ({
  floorIndex,
  rooms,
  allEmployees,
  floorY,
  buildingWidth = 18,
  buildingDepth = 14,
  buildingWorldPos = [0, 0, 0],
}) => {
  const roomsPerRow = 2;

  return (
    <group position={[0, floorY, 0]}>
      {/* Floor slab */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[buildingWidth, 0.18, buildingDepth]} />
        <meshStandardMaterial
          color="#1e293b"
          roughness={0.6}
          metalness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Floor label strip */}
      <mesh position={[-buildingWidth / 2 - 0.6, 0.6, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2, 0.5]} />
        <meshBasicMaterial color="#6366f1" transparent opacity={0.8} />
      </mesh>

      {/* Rooms: 2 per floor, side by side */}
      {rooms.map((room, i) => {
        const col = i % roomsPerRow; // 0 or 1
        const x = (col - 0.5) * (ROOM_W + 0.5);
        const localY = FLOOR_HEIGHT / 2 + 0.1;
        const localZ = 0;

        // Compute world position so camera can zoom to exact room
        const worldOffset: [number, number, number] = [
          buildingWorldPos[0],
          buildingWorldPos[1] + floorY,
          buildingWorldPos[2],
        ];

        return (
          <Room
            key={room.id}
            unit={room}
            position={[x, localY, localZ]}
            employees={allEmployees.filter(e => e.orgUnitId === room.id)}
            width={ROOM_W}
            depth={ROOM_D}
            worldOffset={worldOffset}
          />
        );
      })}
    </group>
  );
};

export default Floor;
