// @ts-nocheck
import * as THREE from 'three';
import { CameraMode } from './useOrgMapStore';

// Building is now 34W x 24D x ~13H — camera needs to be further out
const CAMERA_POSITIONS: Record<string, [number, number, number]> = {
  overview: [0, 50, 90],   // Rộng hơn để thấy cả tòa nhà to
  hq:       [0, 28, 52],   // Nhìn toàn tòa nhà HQ
};
const CAMERA_LOOKATS: Record<string, [number, number, number]> = {
  overview: [0, 4, 0],
  hq:       [0, 8, 0],
};
const BRANCH_DEFAULT: [number, number, number] = [50, 14, 0];

export function getTargetForMode(
  mode: CameraMode,
  branchPositions: Record<string, [number, number, number]> = {},
  roomWorldPos: [number, number, number] | null = null
): { pos: THREE.Vector3; look: THREE.Vector3 } {

  if (mode === 'overview') {
    return {
      pos:  new THREE.Vector3(...CAMERA_POSITIONS.overview),
      look: new THREE.Vector3(...CAMERA_LOOKATS.overview),
    };
  }

  if (mode === 'hq') {
    return {
      pos:  new THREE.Vector3(...CAMERA_POSITIONS.hq),
      look: new THREE.Vector3(...CAMERA_LOOKATS.hq),
    };
  }

  if (mode === 'floor') {
    return {
      pos:  new THREE.Vector3(0, 22, 36),
      look: new THREE.Vector3(0, 6, 0),
    };
  }

  if (typeof mode === 'object' && mode.type === 'branch') {
    const bp = branchPositions[mode.unitId] || BRANCH_DEFAULT;
    return {
      pos:  new THREE.Vector3(bp[0], bp[1] + 18, bp[2] + 24),
      look: new THREE.Vector3(...bp),
    };
  }

  if (typeof mode === 'object' && mode.type === 'room') {
    if (roomWorldPos) {
      const [rx, ry, rz] = roomWorldPos;
      // ry = room box CENTER → đáy phòng = ry - ROOM_H/2
      const ROOM_H = 3.8;
      const floorY = ry - ROOM_H / 2;  // Y level của sàn phòng (nơi có bàn ghế)

      // Isometric 45° từ phía trước-phải, nhìn xuống vào sàn phòng
      // → camera ở ngoài tòa nhà, nhìn vào sàn phòng ở độ cao +8 so với sàn
      return {
        pos:  new THREE.Vector3(rx - 14, floorY + 12, rz + 20),
        look: new THREE.Vector3(rx + 2,  floorY + 1.5, rz - 2),
      };
    }
    return {
      pos:  new THREE.Vector3(-14, 14, 24),
      look: new THREE.Vector3(2, 3, 0),
    };
  }

  return {
    pos:  new THREE.Vector3(...CAMERA_POSITIONS.overview),
    look: new THREE.Vector3(...CAMERA_LOOKATS.overview),
  };
}

export { CAMERA_POSITIONS, CAMERA_LOOKATS };
