// @ts-nocheck
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ConnectionLineProps {
  from: [number, number, number];
  to: [number, number, number];
  color?: string;
}

const ConnectionLine: React.FC<ConnectionLineProps> = ({
  from,
  to,
  color = '#6366f1',
}) => {
  const lineRef = useRef<THREE.Line>(null!);
  const progressRef = useRef(0);

  // Animated dash offset
  useFrame((_, delta) => {
    if (!lineRef.current) return;
    progressRef.current += delta * 0.8;
    const mat = lineRef.current.material as THREE.LineDashedMaterial;
    mat.dashOffset = -progressRef.current;
  });

  const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  return (
    <line ref={lineRef as any} geometry={geometry}>
      <lineDashedMaterial
        color={color}
        dashSize={0.8}
        gapSize={0.4}
        transparent
        opacity={0.5}
        linewidth={1}
      />
    </line>
  );
};

export default ConnectionLine;
