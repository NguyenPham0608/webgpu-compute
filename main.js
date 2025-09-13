
import * as THREE from 'three/webgpu';
import {
    Fn, If, uniform, float, uv, vec3, hash, shapeCircle,
    instancedArray, instanceIndex
} from 'three/tsl';

import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import Stats from 'jsm/libs/stats.module.js';

import { GUI } from 'jsm/libs/lil-gui.module.min.js';

const particleCount = 30000;

const gravity = uniform(- .00098);
const bounce = uniform(.8);
const friction = uniform(.99);
const size = uniform(.12);

const clickPosition = uniform(new THREE.Vector3());

let camera, scene, renderer;
let controls, stats;
let computeParticles;

let isOrbitControlsActive;
let cameraAngleY = 0;
let cameraAngleX = 0.3;
let cameraDistance = 20;

const timestamps = document.getElementById('timestamps');

init();

function init() {

    const { innerWidth, innerHeight } = window;

    camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 1000);
    camera.position.set(0, 9, 20);

    scene = new THREE.Scene();

    //

    const positions = instancedArray(particleCount, 'vec3');
    const velocities = instancedArray(particleCount, 'vec3');
    const colors = instancedArray(particleCount, 'vec3');

    // compute

    const separation = 0.2;
    const amount = Math.sqrt(particleCount);
    const offset = float(amount / 2);

    const computeInit = Fn(() => {

        const position = positions.element(instanceIndex);
        const color = colors.element(instanceIndex);

        const x = instanceIndex.mod(amount);
        const z = instanceIndex.div(amount);

        position.x = offset.sub(x).mul(separation);
        position.z = offset.sub(z).mul(separation);

        color.x = hash(instanceIndex);
        color.y = hash(instanceIndex.add(2));

    })().compute(particleCount);

    //

    const computeUpdate = Fn(() => {

        const position = positions.element(instanceIndex);
        const velocity = velocities.element(instanceIndex);

        velocity.addAssign(vec3(0.00, gravity, 0.00));
        position.addAssign(velocity);

        velocity.mulAssign(friction);

        // floor

        If(position.y.lessThan(0), () => {

            position.y = 0;
            velocity.y = velocity.y.negate().mul(bounce);

            // floor friction

            velocity.x = velocity.x.mul(.9);
            velocity.z = velocity.z.mul(.9);

        });

    });

    computeParticles = computeUpdate().compute(particleCount);

    // create particles

    const material = new THREE.SpriteNodeMaterial();
    material.colorNode = uv().mul(colors.element(instanceIndex));
    material.positionNode = positions.toAttribute();
    material.scaleNode = size;
    material.opacityNode = shapeCircle();
    material.alphaToCoverage = true;
    material.transparent = true;

    const particles = new THREE.Sprite(material);
    particles.count = particleCount;
    particles.frustumCulled = false;
    scene.add(particles);

    //

    const helper = new THREE.GridHelper(90, 45, 0x303030, 0x303030);
    scene.add(helper);

    const geometry = new THREE.PlaneGeometry(200, 200);
    geometry.rotateX(- Math.PI / 2);

    const plane = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(plane);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    //

    renderer = new THREE.WebGPURenderer({ antialias: true, trackTimestamp: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    stats = new Stats();
    document.body.appendChild(stats.dom);

    //

    renderer.computeAsync(computeInit);

    // Hit

    const computeHit = Fn(() => {

        const position = positions.element(instanceIndex);
        const velocity = velocities.element(instanceIndex);

        const dist = position.distance(clickPosition);
        const direction = position.sub(clickPosition).normalize();
        const distArea = float(3).sub(dist).max(0);

        const power = distArea.mul(.01);
        const relativePower = power.mul(hash(instanceIndex).mul(1.5).add(.5));

        velocity.assign(velocity.add(direction.mul(relativePower)));

    })().compute(particleCount);

    //

    function onMove(event) {

        if (isOrbitControlsActive) return;

        pointer.set((event.clientX / window.innerWidth) * 2 - 1, - (event.clientY / window.innerHeight) * 2 + 1);

        raycaster.setFromCamera(pointer, camera);

        const intersects = raycaster.intersectObject(plane, false);

        if (intersects.length > 0) {

            const { point } = intersects[0];

            // move to uniform

            clickPosition.value.copy(point);
            clickPosition.value.y = - 1;

            // compute

            renderer.computeAsync(computeHit);

        }

    }

    renderer.domElement.addEventListener('pointermove', onMove);

    // controls


    window.addEventListener('resize', onWindowResize);

    // gui

    const gui = new GUI();

    gui.add(gravity, 'value', - .0098, 0, 0.0001).name('gravity');
    gui.add(bounce, 'value', .1, 1, 0.01).name('bounce');
    gui.add(friction, 'value', .96, .99, 0.01).name('friction');
    gui.add(size, 'value', .12, .5, 0.01).name('size');

}

function onWindowResize() {

    const { innerWidth, innerHeight } = window;

    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(innerWidth, innerHeight);

}

async function animate() {

    stats.update();

    updateCameraPosition();
    await renderer.computeAsync(computeParticles);
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE);

    await renderer.renderAsync(scene, camera);
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
}

// Add the updateCameraPosition function:
function updateCameraPosition() {
    const x = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
    const y = Math.sin(cameraAngleX) * cameraDistance;
    const z = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;

    camera.position.set(x, y, z);
    camera.lookAt(0, -8, 0); // Match the controls target
}
function onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY * 0.002;
    cameraAngleY += delta;  // This rotates the camera horizontally
    updateCameraPosition();
}

window.addEventListener('wheel', onWheel);
