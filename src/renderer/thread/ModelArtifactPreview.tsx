import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { USDZLoader } from "three/examples/jsm/loaders/USDZLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import styles from "./CodeBlock.module.css";
import { scrollThreadByWheel } from "./threadScroll.js";

export function ModelArtifactPreview({ src, name }: { src: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError(null);
    const scene = new THREE.Scene();
    scene.background = canvasColor(element);
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 10_000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.replaceChildren(renderer.domElement);
    const routeWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !scrollThreadByWheel(renderer.domElement, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    renderer.domElement.addEventListener("wheel", routeWheel, { passive: false });
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .08;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4d5560, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 6, 5);
    scene.add(key);
    let model: THREE.Object3D | null = null;
    let disposed = false;
    const resize = () => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    void loadModel(src, name).then((value) => {
      if (disposed) { disposeObject(value); return; }
      model = value;
      scene.add(value);
      frameModel(value, camera, controls);
    }).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", routeWheel);
      if (model) disposeObject(model);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [name, src]);
  return <div className={styles.modelArtifact} aria-label={name}><div className={styles.modelArtifactStage} ref={host} />{error && <span className={styles.renderError}>{error}</span>}</div>;
}

async function loadModel(src: string, name: string): Promise<THREE.Object3D> {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "glb" || extension === "gltf") return (await new GLTFLoader().loadAsync(src)).scene;
  if (extension === "obj") return new OBJLoader().loadAsync(src);
  if (extension === "usdz") return new USDZLoader().loadAsync(src);
  if (extension === "stl") return mesh(await new STLLoader().loadAsync(src));
  if (extension === "ply") return mesh(await new PLYLoader().loadAsync(src));
  throw new Error(`Unsupported 3D format: ${extension || name}`);
}

function mesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xb9b4aa,
    metalness: .08,
    roughness: .72,
    side: THREE.DoubleSide,
    vertexColors: Boolean(geometry.getAttribute("color")),
  }));
}

function frameModel(model: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  model.position.sub(center);
  const radius = Math.max(size.x, size.y, size.z) * .5 || 1;
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) * 1.35;
  camera.position.set(distance * .72, distance * .48, distance);
  camera.near = Math.max(.001, distance / 1_000);
  camera.far = Math.max(100, distance * 100);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * .12;
  controls.maxDistance = radius * 24;
  controls.update();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

function canvasColor(element: HTMLElement): THREE.Color {
  const value = getComputedStyle(element).getPropertyValue("--color-media-canvas").trim();
  try { return new THREE.Color(value || "#17191d"); } catch { return new THREE.Color("#17191d"); }
}
