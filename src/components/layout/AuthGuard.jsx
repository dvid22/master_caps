import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import * as THREE from "three";

import { useAuth } from "../../context/AuthContext";

const MIN_SPLASH_TIME = 4200;

export default function AuthGuard({ children }) {
  const {
    loading,
    isAuthenticated,
    hasProfile,
    isActive,
    belongsToStore,
    canAccessPanel,
  } = useAuth();

  const [splashFinished, setSplashFinished] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSplashFinished(true);
    }, MIN_SPLASH_TIME);

    return () => window.clearTimeout(timer);
  }, []);

  if (loading || !splashFinished) {
    return <StoreSplashLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasProfile) {
    return (
      <GuardMessage
        title="Usuario sin perfil"
        description="Tu cuenta existe en Firebase Auth, pero no tiene perfil creado en la colección users."
      />
    );
  }

  if (!isActive) {
    return (
      <GuardMessage
        title="Usuario inactivo"
        description="Tu acceso fue desactivado. Contacta al administrador de Master Caps."
      />
    );
  }

  if (!belongsToStore) {
    return (
      <GuardMessage
        title="Tienda no autorizada"
        description="Tu usuario no pertenece a esta tienda."
      />
    );
  }

  if (!canAccessPanel) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function StoreSplashLoader() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white">
      <style>
        {`
          @keyframes mcLoaderIn {
            0% {
              opacity: 0;
              transform: scale(.97);
              filter: blur(8px);
            }
            100% {
              opacity: 1;
              transform: scale(1);
              filter: blur(0);
            }
          }

          @keyframes mcHalo {
            0%, 100% {
              opacity: .18;
              transform: scale(.92);
            }
            50% {
              opacity: .42;
              transform: scale(1.05);
            }
          }
        `}
      </style>

      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-50 blur-3xl"
        style={{ animation: "mcHalo 3.4s ease-in-out infinite" }}
      />

      <section
        className="relative h-[560px] w-full max-w-[760px] px-4 sm:h-[640px]"
        style={{ animation: "mcLoaderIn .8s cubic-bezier(.2,.8,.2,1) both" }}
      >
        <ThreeTagLoader />
      </section>
    </main>
  );
}

function ThreeTagLoader() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ffffff");

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.1, 7.7);
    camera.lookAt(0, 0.05, 0);

    let renderer;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.error("No se pudo iniciar WebGL:", error);
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.className = "absolute inset-0 h-full w-full";

    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.HemisphereLight("#ffffff", "#d5d5d8", 2.1);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight("#fffaf7", 5.4);
    keyLight.position.set(4.5, 6, 6);
    keyLight.castShadow = false;
    scene.add(keyLight);

    const redRim = new THREE.DirectionalLight("#d91f2b", 1.25);
    redRim.position.set(-4, 3, -2);
    scene.add(redRim);

    const fill = new THREE.PointLight("#ffffff", 18, 10, 2);
    fill.position.set(0, 2.5, 4.5);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    scene.add(floor);

    const tagRig = new THREE.Group();
    scene.add(tagRig);

    const tag = createPremiumTag();
    tagRig.add(tag);

    const cord = createPremiumCord();
    cord.position.y = 2.7;
    tagRig.add(cord);

    const shadowGroup = new THREE.Group();
    shadowGroup.position.set(0, -2.46, 0.42);
    scene.add(shadowGroup);

    const shadowCore = new THREE.Mesh(
      new THREE.CircleGeometry(1.48, 96),
      new THREE.MeshBasicMaterial({
        map: createSoftShadowTexture(),
        color: "#1b1513",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    shadowCore.rotation.x = -Math.PI / 2;
    shadowCore.scale.set(1.5, 0.42, 1);
    shadowGroup.add(shadowCore);

    const shadowAmbient = new THREE.Mesh(
      new THREE.CircleGeometry(2.05, 96),
      new THREE.MeshBasicMaterial({
        map: createSoftShadowTexture(),
        color: "#5b3737",
        transparent: true,
        opacity: 0.065,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    shadowAmbient.rotation.x = -Math.PI / 2;
    shadowAmbient.position.y = -0.008;
    shadowAmbient.scale.set(1.42, 0.37, 1);
    shadowGroup.add(shadowAmbient);

    const textureLoader = new THREE.TextureLoader();

    textureLoader.load(
      "/logo.png",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(
          renderer.capabilities.getMaxAnisotropy(),
          8
        );
        texture.needsUpdate = true;

        const imageWidth = texture.image?.naturalWidth || texture.image?.width || 1;
        const imageHeight = texture.image?.naturalHeight || texture.image?.height || 1;
        const aspect = imageWidth / imageHeight;

        const maxWidth = 2.9;
        const maxHeight = 2.18;

        let logoWidth = maxWidth;
        let logoHeight = logoWidth / aspect;

        if (logoHeight > maxHeight) {
          logoHeight = maxHeight;
          logoWidth = logoHeight * aspect;
        }

        const logoMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.01,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        });

        const logoPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(logoWidth, logoHeight),
          logoMaterial
        );

        /*
         * La cara frontal de la etiqueta queda cerca de z = 0.16
         * por el extruido y el bisel. Se coloca el logo más adelante
         * y sin prueba de profundidad para evitar que quede oculto.
         */
        logoPlane.position.set(0, -0.04, 0.255);
        logoPlane.renderOrder = 20;
        tag.add(logoPlane);
      },
      undefined,
      (error) => {
        console.error("No se pudo cargar /logo.png:", error);
      }
    );

    const clock = new THREE.Clock();

    const dropStartY = 5.9;
    const restY = 0.08;
    let velocityY = 0;
    let positionY = dropStartY;
    let settled = false;
    let entered = false;

    tagRig.position.y = dropStartY;
    tagRig.rotation.z = -0.12;
    tagRig.rotation.y = 0.18;

    function resize() {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);

      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      if (width < 520) {
        camera.position.z = 9.0;
      } else {
        camera.position.z = 7.7;
      }
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.033);
      const elapsed = clock.elapsedTime;

      if (!settled) {
        const gravity = -18.8;
        velocityY += gravity * delta;
        positionY += velocityY * delta;

        if (positionY <= restY) {
          positionY = restY;

          if (Math.abs(velocityY) > 0.6) {
            velocityY = -velocityY * 0.34;
          } else {
            velocityY = 0;
            settled = true;
          }

          entered = true;
        }

        tagRig.position.y = positionY;
      } else {
        tagRig.position.y =
          restY + Math.sin(elapsed * 1.65) * 0.025;
      }

      const swingStrength = entered
        ? Math.exp(-Math.max(elapsed - 0.65, 0) * 1.45)
        : 1;

      tagRig.rotation.z =
        Math.sin(elapsed * 4.2) * 0.11 * swingStrength +
        Math.sin(elapsed * 0.9) * 0.015;

      tagRig.rotation.y =
        Math.sin(elapsed * 2.9 + 0.8) * 0.09 * swingStrength +
        Math.sin(elapsed * 0.65) * 0.025;

      tagRig.rotation.x =
        Math.cos(elapsed * 2.5) * 0.038 * swingStrength;

      const heightFromRest = Math.max(tagRig.position.y - restY, 0);
      const shadowScale = THREE.MathUtils.clamp(
        1.18 - heightFromRest * 0.055,
        0.72,
        1.18
      );

      shadowGroup.position.x = tagRig.position.x * 0.1;
      shadowGroup.rotation.z = -tagRig.rotation.z * 0.08;

      shadowCore.scale.set(
        1.5 * shadowScale,
        0.42 * shadowScale,
        1
      );
      shadowAmbient.scale.set(
        1.42 * shadowScale,
        0.37 * shadowScale,
        1
      );

      shadowCore.material.opacity = THREE.MathUtils.clamp(
        0.18 - heightFromRest * 0.018,
        0.035,
        0.18
      );

      shadowAmbient.material.opacity = THREE.MathUtils.clamp(
        0.065 - heightFromRest * 0.006,
        0.018,
        0.065
      );

      renderer.render(scene, camera);
    });

    return () => {
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);

      scene.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          materials.forEach((material) => {
            Object.values(material).forEach((value) => {
              if (value?.isTexture) value.dispose();
            });

            material.dispose();
          });
        }
      });

      renderer.dispose();
      renderer.forceContextLoss();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      aria-label="Etiqueta tridimensional Master Caps cayendo y rebotando"
    />
  );
}

function createPremiumTag() {
  const group = new THREE.Group();

  const shape = createRoundedRectangleShape(3.45, 4.05, 0.22);

  const tagMaterial = new THREE.MeshPhysicalMaterial({
    color: "#fcfbf8",
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.72,
    sheen: 0.12,
    sheenColor: new THREE.Color("#ffffff"),
  });

  const tagBody = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelSegments: 5,
      bevelSize: 0.055,
      bevelThickness: 0.045,
      curveSegments: 20,
    }),
    tagMaterial
  );

  tagBody.geometry.center();
  tagBody.castShadow = false;
  tagBody.receiveShadow = true;
  group.add(tagBody);

  const hole = new THREE.Mesh(
    new THREE.TorusGeometry(0.165, 0.045, 20, 48),
    new THREE.MeshStandardMaterial({
      color: "#332a26",
      roughness: 0.2,
      metalness: 0.95,
    })
  );

  hole.position.set(0, 1.53, 0.13);
  hole.castShadow = false;
  group.add(hole);

  const innerHole = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 40),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
    })
  );

  innerHole.position.set(0, 1.53, 0.135);
  group.add(innerHole);

  const innerBorderShape = createRoundedRectangleShape(3.08, 3.68, 0.18);
  const innerBorder = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      innerBorderShape.getPoints(80).map(
        (point) => new THREE.Vector3(point.x, point.y, 0.19)
      )
    ),
    new THREE.LineBasicMaterial({
      color: "#b7a89c",
      transparent: true,
      opacity: 0.34,
    })
  );
  group.add(innerBorder);

  const topAccent = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.028),
    new THREE.MeshBasicMaterial({
      color: "#b20f1a",
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    })
  );
  topAccent.position.set(0, 1.18, 0.2);
  group.add(topAccent);

  const bottomCaption = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.04),
    new THREE.MeshBasicMaterial({
      color: "#1f1f1f",
      transparent: true,
      opacity: 0.18,
      toneMapped: false,
    })
  );
  bottomCaption.position.set(0, -1.58, 0.2);
  group.add(bottomCaption);

  const detailLine = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.012),
    new THREE.MeshBasicMaterial({
      color: "#b20f1a",
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    })
  );

  detailLine.position.set(0, -1.38, 0.106);
  group.add(detailLine);

  const centerDiamond = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 4),
    new THREE.MeshBasicMaterial({
      color: "#b20f1a",
      toneMapped: false,
    })
  );

  centerDiamond.rotation.z = Math.PI / 4;
  centerDiamond.position.set(0, -1.38, 0.11);
  group.add(centerDiamond);

  return group;
}

function createPremiumCord() {
  const group = new THREE.Group();

  const darkMaterial = new THREE.MeshPhysicalMaterial({
    color: "#241b18",
    roughness: 0.48,
    metalness: 0.03,
    clearcoat: 0.08,
    clearcoatRoughness: 0.72,
  });

  const warmHighlightMaterial = new THREE.MeshStandardMaterial({
    color: "#5a4038",
    roughness: 0.52,
    metalness: 0.02,
  });

  const cordPaths = [
    {
      points: [
        new THREE.Vector3(-0.15, 3.2, 0.02),
        new THREE.Vector3(-0.13, 2.35, 0.02),
        new THREE.Vector3(-0.12, 1.35, 0.04),
        new THREE.Vector3(-0.11, 0.2, 0.06),
        new THREE.Vector3(-0.055, -1.02, 0.075),
      ],
      material: darkMaterial,
      radius: 0.026,
    },
    {
      points: [
        new THREE.Vector3(0.15, 3.2, 0.02),
        new THREE.Vector3(0.13, 2.35, 0.02),
        new THREE.Vector3(0.12, 1.35, 0.04),
        new THREE.Vector3(0.11, 0.2, 0.06),
        new THREE.Vector3(0.055, -1.02, 0.075),
      ],
      material: darkMaterial,
      radius: 0.026,
    },
    {
      points: [
        new THREE.Vector3(-0.136, 3.18, 0.043),
        new THREE.Vector3(-0.115, 2.35, 0.048),
        new THREE.Vector3(-0.104, 1.35, 0.058),
        new THREE.Vector3(-0.095, 0.2, 0.073),
        new THREE.Vector3(-0.045, -1.01, 0.09),
      ],
      material: warmHighlightMaterial,
      radius: 0.006,
    },
    {
      points: [
        new THREE.Vector3(0.136, 3.18, 0.043),
        new THREE.Vector3(0.115, 2.35, 0.048),
        new THREE.Vector3(0.104, 1.35, 0.058),
        new THREE.Vector3(0.095, 0.2, 0.073),
        new THREE.Vector3(0.045, -1.01, 0.09),
      ],
      material: warmHighlightMaterial,
      radius: 0.006,
    },
  ];

  cordPaths.forEach(({ points, material, radius }) => {
    const curve = new THREE.CatmullRomCurve3(points);

    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, radius, 12, false),
      material
    );

    mesh.castShadow = false;
    group.add(mesh);
  });

  const knot = new THREE.Group();
  knot.position.set(0, -1.09, 0.09);

  const knotBody = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.105, 0.028, 96, 14, 2, 3),
    darkMaterial
  );
  knotBody.scale.set(0.84, 1.05, 0.7);
  knotBody.rotation.x = Math.PI / 2;
  knotBody.rotation.z = Math.PI / 4;
  knot.add(knotBody);

  const leftTail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.02, 0.35, 12),
    darkMaterial
  );
  leftTail.position.set(-0.055, -0.18, 0);
  leftTail.rotation.z = -0.11;
  knot.add(leftTail);

  const rightTail = leftTail.clone();
  rightTail.position.x = 0.055;
  rightTail.rotation.z = 0.11;
  knot.add(rightTail);

  group.add(knot);

  return group;
}

function createSoftShadowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );

  gradient.addColorStop(0, "rgba(0,0,0,0.82)");
  gradient.addColorStop(0.28, "rgba(0,0,0,0.52)");
  gradient.addColorStop(0.62, "rgba(0,0,0,0.16)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

function createRoundedRectangleShape(width, height, radius) {
  const shape = new THREE.Shape();

  const x = -width / 2;
  const y = -height / 2;

  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  return shape;
}

function GuardMessage({ title, description }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <section className="w-full max-w-md rounded-[30px] bg-white p-8 text-center shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06]">
        <img
          src="/logo.png"
          alt="Master Caps"
          className="mx-auto h-20 w-auto object-contain"
        />

        <h1 className="mt-5 text-[24px] font-medium tracking-[-0.04em] text-black">
          {title}
        </h1>

        <p className="mt-2 text-[14px] leading-6 text-black/50">
          {description}
        </p>
      </section>
    </main>
  );
}