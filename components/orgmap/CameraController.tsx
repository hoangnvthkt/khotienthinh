// @ts-nocheck
import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrgMapStore } from './useOrgMapStore';
import { getTargetForMode, CAMERA_POSITIONS, CAMERA_LOOKATS } from './cameraHelpers';

interface CameraControllerProps {
  branchPositions?: Record<string, [number, number, number]>;
  orbitRef?: React.MutableRefObject<any>;
}

const CameraController: React.FC<CameraControllerProps> = ({ branchPositions = {}, orbitRef }) => {
  const { cameraMode, roomWorldPos } = useOrgMapStore();
  const { camera } = useThree();

  // Animation state
  const isAnimating = useRef(false);
  const animTarget = useRef({
    pos: new THREE.Vector3(...CAMERA_POSITIONS.overview),
    look: new THREE.Vector3(...CAMERA_LOOKATS.overview),
  });
  const currentLook = useRef(new THREE.Vector3(...CAMERA_LOOKATS.overview));

  // When cameraMode changes → compute new target and START animation
  useEffect(() => {
    const { pos, look } = getTargetForMode(cameraMode, branchPositions, roomWorldPos);
    animTarget.current.pos.copy(pos);
    animTarget.current.look.copy(look);
    isAnimating.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, roomWorldPos]);

  useFrame(() => {
    if (!isAnimating.current) return;

    const { pos, look } = animTarget.current;

    // Lerp camera position
    camera.position.lerp(pos, 0.07);

    // Lerp look target
    currentLook.current.lerp(look, 0.07);
    camera.lookAt(currentLook.current);

    // Also update OrbitControls target so it orbits around the right point
    if (orbitRef?.current) {
      orbitRef.current.target.lerp(currentLook.current, 0.07);
      orbitRef.current.update();
    }

    // Check if close enough → stop animation, hand control back to OrbitControls
    const posClose = camera.position.distanceTo(pos) < 0.15;
    const lookClose = currentLook.current.distanceTo(look) < 0.15;
    if (posClose && lookClose) {
      camera.position.copy(pos);
      currentLook.current.copy(look);
      camera.lookAt(look);
      if (orbitRef?.current) {
        orbitRef.current.target.copy(look);
        orbitRef.current.update();
      }
      isAnimating.current = false;  // ← Dừng lerp, OrbitControls tự do từ đây
    }
  });

  return null;
};

export default CameraController;
