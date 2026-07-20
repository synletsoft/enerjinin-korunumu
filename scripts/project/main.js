const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const MAX_HEIGHT_M = 400;
const MIN_HEIGHT_M = 0;
const FRAME_COUNT = 241;
const FRAME_MAX = FRAME_COUNT - 1;
const RAMP_RADIUS_M = 115;
const FRICTION_COEFFICIENT = 0.7;
const SIMULATION_TIME_SCALE = 1;
const PHYSICS_SUBSTEP = 1 / 120;
const MIN_LAUNCH_OMEGA = 0.018;
const VISUAL_FRAME_CATCHUP = 24;
const VISUAL_MAX_FRAME_STEP = 1.85;
const MASS_VALUES = [5, 10, 15, 20, 25];

const PLANETS = [
	{ key: "earth", name: "Dünya", g: 10, frame: 0, iconFrame: 0 },
	{ key: "moon", name: "Ay", g: 1.5, frame: 1, iconFrame: 1 },
	{ key: "mars", name: "Mars", g: 3.5, frame: 2, iconFrame: 2 }
];

const METRIC_POSITIONS = {
	speed: { x: 156.5, y: 62, w: 235 },
	height: { x: 374, y: 62, w: 235 },
	ke: { x: 589, y: 62, w: 235 },
	pe: { x: 828, y: 62, w: 280 },
	heat: { x: 1068, y: 62, w: 235 },
	total: { x: 1285, y: 62, w: 235 }
};

const PLANET_BUTTONS = [
	{ key: "earth", x: 113, y: 318 },
	{ key: "moon", x: 113, y: 453 },
	{ key: "mars", x: 113, y: 588 }
];

let activeApp = null;

if (typeof runOnStartup === "function")
{
	runOnStartup(runtime =>
	{
		runtime.addEventListener("afteranylayoutstart", event =>
		{
			if (event.layout.name === "game")
				createEnergyApp(runtime);
			else
				removeEnergyApp();
		});
	});
}
else
{
	window.addEventListener("DOMContentLoaded", () => createEnergyApp(null));
}

function createEnergyApp(runtime)
{
	removeEnergyApp();
	injectEnergyStyles();

	const state = {
		runtime,
		phase: "idle",
		planetKey: "earth",
		massIndex: 3,
		heightM: 200,
		theta: Math.PI,
		omega: 0,
		heat: 0,
		motionDirection: 1,
		visualFrame: 0,
		targetFrame: 0,
		visualFrameSpeed: 0,
		lastMeasuredFrame: 0,
		lastAppliedFrame: -1,
		lastVisualTime: performance.now(),
		lastUiRenderTime: 0,
		tickCount: 0,
		lastTickTime: 0,
		friction: false,
		muted: false,
		lastFrameTime: performance.now(),
		raf: 0,
		construct: getConstructObjects(runtime)
	};

	const host = document.createElement("div");
	host.id = "energy-conservation-host";
	host.className = runtime ? "is-construct" : "is-standalone";
	host.innerHTML = runtime ? constructMarkup() : standaloneMarkup();

	document.body.appendChild(host);
	state.host = host;
	state.stage = host.querySelector(".energy-stage");
	state.chart = host.querySelector(".energy-chart");
	state.bg = host.querySelector(".energy-bg");
	state.car = host.querySelector(".energy-car");
	installEnergyDebugProbe(state);

	wireEnergyControls(state);
	resetMotion(state);
	updateScale(state);
	renderEnergyApp(state);

	window.addEventListener("resize", state.resizeHandler = () => updateScale(state), { passive: true });
	if (runtime)
	{
		state.tickHandler = () => tickEnergyApp(state, performance.now());
		runtime.addEventListener("tick", state.tickHandler);
	}
	else
	{
		state.raf = requestAnimationFrame(time => tickEnergyApp(state, time));
	}

	activeApp = state;
}

function installEnergyDebugProbe(state)
{
	const root = typeof globalThis !== "undefined" ? globalThis : window;
	root.__energyDebug = {
		version: "runtime-tick-probe-2026-07-20",
		get mode() { return state.runtime ? "construct" : "standalone"; },
		get phase() { return state.phase; },
		get tickCount() { return state.tickCount; },
		get lastTickTime() { return state.lastTickTime; },
		get hasRuntime() { return !!state.runtime; },
		get hasConstructCar() { return !!state.construct.car; },
		get carFrame() { return state.construct.car?.animationFrame ?? null; },
		get carSpeed() { return state.construct.car?.animationSpeed ?? null; },
		get visualFrame() { return state.visualFrame; },
		get targetFrame() { return state.targetFrame; },
		get visualFrameSpeed() { return state.visualFrameSpeed; },
		get theta() { return state.theta; },
		get omega() { return state.omega; },
		get speedText() { return state.host.querySelector('[data-metric="speed"]')?.textContent ?? ""; },
		get heightText() { return state.host.querySelector('[data-metric="height"]')?.textContent ?? ""; }
	};
}

function removeEnergyApp()
{
	if (!activeApp)
	{
		document.getElementById("energy-conservation-host")?.remove();
		return;
	}

	cancelAnimationFrame(activeApp.raf);
	window.removeEventListener("resize", activeApp.resizeHandler);
	if (activeApp.runtime && activeApp.tickHandler)
		activeApp.runtime.removeEventListener?.("tick", activeApp.tickHandler);
	activeApp.host.remove();
	activeApp = null;
}

function constructMarkup()
{
	return `
		<div class="energy-stage">
			${metricValuesMarkup()}
			${planetZonesMarkup()}
			<canvas class="energy-chart construct-chart" width="244" height="146" aria-label="Enerji grafiği"></canvas>
			<label class="friction-toggle construct-friction">
				<input type="checkbox" data-control="friction">
				<i></i>
			</label>
			<div class="construct-run-buttons">
				<button class="start-button" type="button" data-action="start">${iconPlay()}<span>Başlat</span></button>
				<button class="reset-button" type="button" data-action="reset">${iconUndo()}<span>Sıfırla</span></button>
			</div>
			${sliderReadoutsMarkup()}
			${sliderControlsMarkup()}
			<div class="info-popover" aria-live="polite"></div>
		</div>
	`;
}

function standaloneMarkup()
{
	return `
		<div class="energy-standalone-scene" aria-hidden="true">
			<img class="energy-bg" alt="">
			<img class="energy-car" alt="">
		</div>
		<div class="energy-stage">
			<section class="standalone-metric-cards" aria-label="Enerji değerleri">
				${metricCardMarkup("speed", "Hız(V)")}
				${metricCardMarkup("height", "Yükseklik(h)")}
				${metricCardMarkup("ke", "Kinetik Enerji")}
				${metricCardMarkup("pe", "Potansiyel Enerji")}
				${metricCardMarkup("heat", "Isı Enerjisi")}
				${metricCardMarkup("total", "Toplam Enerji")}
			</section>
			<nav class="standalone-top-actions" aria-label="Uygulama araçları">
				<button class="round-tool" type="button" data-action="reset-all" aria-label="Yeniden başlat">${iconRefresh()}</button>
				<button class="round-tool" type="button" data-action="sound" aria-label="Ses">${iconSound()}</button>
				<button class="round-tool" type="button" data-action="menu" aria-label="Bilgi">${iconList()}</button>
				<button class="round-tool" type="button" data-action="share" aria-label="Paylaş">${iconShare()}</button>
				<button class="round-tool" type="button" data-action="fullscreen" aria-label="Tam ekran">${iconFullscreen()}</button>
			</nav>
			<section class="standalone-planets" aria-label="Ortam seçimi">
				${PLANETS.map(planet => `
					<button class="standalone-planet-button" type="button" data-planet="${planet.key}" aria-label="${planet.name}">
						<img src="${asset(`images/gezegenbtn-default-00${planet.iconFrame}.png`)}" alt="">
					</button>
				`).join("")}
			</section>
			<section class="standalone-graph" aria-label="Enerji grafiği">
				<div class="graph-title">${iconChart()}<span>Enerji Grafiği</span></div>
				<canvas class="energy-chart" width="244" height="146"></canvas>
				<label class="friction-toggle standalone-friction">
					<span>Sürtünme<br>Kuvveti</span>
					<input type="checkbox" data-control="friction">
					<i></i>
				</label>
			</section>
			<aside class="standalone-panel" aria-label="Parametreler">
				<div class="construct-run-buttons">
					<button class="start-button" type="button" data-action="start">${iconPlay()}<span>Başlat</span></button>
					<button class="reset-button" type="button" data-action="reset">${iconUndo()}<span>Sıfırla</span></button>
				</div>
				${sliderReadoutsMarkup()}
				${sliderControlsMarkup()}
				<div class="standalone-slider-label mass">Kütle<br>(m)</div>
				<div class="standalone-slider-label height">Yükseklik<br>(h)</div>
			</aside>
			${planetZonesMarkup()}
			<div class="info-popover" aria-live="polite"></div>
		</div>
	`;
}

function metricValuesMarkup()
{
	return Object.entries(METRIC_POSITIONS).map(([key, pos]) =>
		`<strong class="metric-value" data-metric="${key}" style="left:${pos.x - pos.w / 2}px;top:${pos.y}px;width:${pos.w}px">0.0</strong>`
	).join("");
}

function metricCardMarkup(key, label)
{
	const extraClass = key === "pe" ? " is-wide" : "";
	return `
		<article class="metric-card${extraClass}">
			<span>${label}</span>
			<strong data-metric="${key}">0.0</strong>
		</article>
	`;
}

function planetZonesMarkup()
{
	return PLANET_BUTTONS.map(button => `
		<button class="planet-zone" type="button" data-planet="${button.key}" aria-label="${button.key}" style="left:${button.x - 55}px;top:${button.y - 55}px"></button>
	`).join("");
}

function sliderReadoutsMarkup()
{
	return `
		<div class="slider-readout mass" data-readout="mass">20 kg</div>
		<div class="slider-readout height" data-readout="height">200 m</div>
	`;
}

function sliderControlsMarkup()
{
	return `
		<div class="slider-control mass" data-slider="mass">
			<input type="range" min="0" max="4" step="1" value="3" data-control="mass" aria-label="Kütle">
			<span class="slider-handle"></span>
		</div>
		<div class="slider-control height" data-slider="height">
			<input type="range" min="${MIN_HEIGHT_M}" max="${MAX_HEIGHT_M}" step="5" value="200" data-control="height" aria-label="Yükseklik">
			<span class="slider-handle"></span>
		</div>
	`;
}

function wireEnergyControls(state)
{
	state.host.querySelectorAll("[data-planet]").forEach(button =>
	{
		button.addEventListener("click", () =>
		{
			state.planetKey = button.dataset.planet;
			resetMotion(state);
			renderEnergyApp(state);
		});
	});

	state.host.querySelector('[data-control="mass"]').addEventListener("input", event =>
	{
		state.massIndex = Number(event.currentTarget.value);
		resetMotion(state);
		renderEnergyApp(state);
	});

	state.host.querySelector('[data-control="height"]').addEventListener("input", event =>
	{
		state.heightM = Number(event.currentTarget.value);
		resetMotion(state);
		renderEnergyApp(state);
	});

	state.host.querySelector('[data-control="friction"]').addEventListener("change", event =>
	{
		state.friction = event.currentTarget.checked;
		renderEnergyApp(state);
	});

	state.host.querySelector('[data-action="start"]').addEventListener("click", () =>
	{
		if (state.phase === "running")
			state.phase = "paused";
		else
		{
			if (Math.abs(state.omega) < MIN_LAUNCH_OMEGA)
				state.omega = Math.sign(Math.cos(state.theta) || -1) * MIN_LAUNCH_OMEGA;

			state.phase = "running";
			state.lastFrameTime = performance.now();
		}

		renderEnergyApp(state);
	});

	state.host.querySelector('[data-action="reset"]').addEventListener("click", () =>
	{
		resetMotion(state);
		renderEnergyApp(state);
	});

	state.host.querySelector('[data-action="reset-all"]')?.addEventListener("click", () =>
	{
		state.massIndex = 3;
		state.heightM = 200;
		state.planetKey = "earth";
		state.friction = false;
		state.host.querySelector('[data-control="mass"]').value = "3";
		state.host.querySelector('[data-control="height"]').value = "200";
		state.host.querySelector('[data-control="friction"]').checked = false;
		resetMotion(state);
		renderEnergyApp(state);
	});

	state.host.querySelector('[data-action="sound"]')?.addEventListener("click", event =>
	{
		state.muted = !state.muted;
		event.currentTarget.classList.toggle("is-muted", state.muted);
	});

	state.host.querySelector('[data-action="menu"]')?.addEventListener("click", () => showPlanetInfo(state));
	state.host.querySelector('[data-action="share"]')?.addEventListener("click", shareSimulation);
	state.host.querySelector('[data-action="fullscreen"]')?.addEventListener("click", toggleFullscreen);
}

function resetMotion(state)
{
	state.theta = thetaFromHeight(state.heightM, -1);
	state.omega = 0;
	state.heat = 0;
	state.motionDirection = 1;
	state.visualFrame = frameFloatFromTheta(state.theta);
	state.targetFrame = state.visualFrame;
	state.visualFrameSpeed = 0;
	state.lastMeasuredFrame = frameFromTheta(state.theta);
	state.lastAppliedFrame = -1;
	state.lastVisualTime = performance.now();
	state.lastUiRenderTime = 0;
	state.phase = "idle";
	state.lastFrameTime = performance.now();
}

function tickEnergyApp(state, time)
{
	const dt = Math.min(0.02, Math.max(0, (time - state.lastFrameTime) / 1000));
	state.lastFrameTime = time;
	state.tickCount += 1;
	state.lastTickTime = time;

	if (state.phase === "running")
	{
		advancePhysics(state, dt);
		renderEnergyApp(state);
	}

	if (!state.runtime)
		state.raf = requestAnimationFrame(nextTime => tickEnergyApp(state, nextTime));
}

function stepPhysics(state, dt)
{
	const planet = getPlanet(state);
	const mass = getMass(state);
	const previousTheta = state.theta;
	const gravityAngular = (planet.g / RAMP_RADIUS_M) * Math.cos(state.theta);
	const frictionAngular = state.friction && Math.abs(state.omega) > 0.0001
		? (FRICTION_COEFFICIENT * planet.g / RAMP_RADIUS_M) * Math.sign(state.omega)
		: 0;

	if (Math.abs(state.omega) <= 0.0001)
	{
		const staticLimit = state.friction ? FRICTION_COEFFICIENT * planet.g / RAMP_RADIUS_M : 0;
		if (Math.abs(gravityAngular) <= staticLimit)
		{
			state.phase = "paused";
			state.omega = 0;
			return;
		}
	}

	state.omega += (gravityAngular - frictionAngular) * dt;
	state.theta += state.omega * dt;

	if (state.theta <= 0 || state.theta >= Math.PI)
	{
		state.theta = Math.max(0, Math.min(Math.PI, state.theta));
		state.omega *= -0.98;
	}

	const distanceM = Math.abs(state.theta - previousTheta) * RAMP_RADIUS_M;
	if (state.friction)
		state.heat = Math.min(initialEnergy(state), state.heat + FRICTION_COEFFICIENT * mass * planet.g * distanceM);

	const availableKe = initialEnergy(state) - state.heat - potentialEnergy(state);
	if (availableKe <= 0.01)
	{
		const accelerationDirection = Math.sign((planet.g / RAMP_RADIUS_M) * Math.cos(state.theta));
		state.omega = Math.abs(state.omega) < 0.0001 ? accelerationDirection * 0.0001 : -state.omega * 0.35;
	}
	else
	{
		const speed = Math.sqrt((2 * availableKe) / mass);
		const sign = Math.sign(state.omega || gravityAngular || -1);
		state.omega = sign * speed / RAMP_RADIUS_M;
	}
}

function renderEnergyApp(state)
{
	const now = performance.now();
	const mass = getMass(state);
	const total = initialEnergy(state);
	const pe = Math.min(total, potentialEnergy(state));
	const heat = state.friction ? Math.min(state.heat, total) : 0;
	const ke = Math.max(0, total - heat - pe);
	const speed = Math.sqrt((2 * ke) / mass);
	const height = heightFromTheta(state.theta);
	const frame = frameFloatFromTheta(state.theta);
	const shouldUpdateUi = state.phase !== "running" || now - state.lastUiRenderTime >= 50;

	updateConstructScene(state, frame, speed);
	updateStandaloneScene(state, frame);

	if (!shouldUpdateUi)
		return;

	state.lastUiRenderTime = now;

	setMetric(state, "speed", `${formatNumber(speed)} m/s`);
	setMetric(state, "height", `${formatNumber(height)} m`);
	setMetric(state, "ke", `${formatNumber(ke)} J`);
	setMetric(state, "pe", `${formatNumber(pe)} J`);
	setMetric(state, "heat", `${formatNumber(heat)} J`);
	setMetric(state, "total", `${formatNumber(total)} J`);

	state.host.querySelector('[data-readout="mass"]').textContent = `${mass} kg`;
	state.host.querySelector('[data-readout="height"]').textContent = `${state.heightM.toFixed(0)} m`;
	updateStartButton(state);
	updatePlanetSelection(state);
	updateSliderHandles(state);
	drawChart(state, { ke, pe, heat, total });
}

function advancePhysics(state, dt)
{
	const scaledDt = dt * SIMULATION_TIME_SCALE;
	const stepCount = Math.max(1, Math.ceil(scaledDt / PHYSICS_SUBSTEP));

	for (let i = 0; i < stepCount; i++)
		stepPhysics(state, scaledDt / stepCount);

	state.lastMeasuredFrame = frameFromTheta(state.theta);
}

function setMetric(state, key, value)
{
	state.host.querySelector(`[data-metric="${key}"]`).textContent = value;
}

function updateStartButton(state)
{
	const button = state.host.querySelector('[data-action="start"]');
	const label = button.querySelector("span");
	button.classList.toggle("is-running", state.phase === "running");
	button.classList.toggle("is-paused", state.phase === "paused");

	if (state.phase === "running")
		label.textContent = "Durdur";
	else if (state.phase === "paused")
		label.textContent = "Devam Et";
	else
		label.textContent = "Başlat";
}

function updatePlanetSelection(state)
{
	state.host.querySelectorAll("[data-planet]").forEach(button =>
		button.classList.toggle("is-selected", button.dataset.planet === state.planetKey));
}

function updateSliderHandles(state)
{
	const massRatio = state.massIndex / (MASS_VALUES.length - 1);
	const heightRatio = (state.heightM - MIN_HEIGHT_M) / (MAX_HEIGHT_M - MIN_HEIGHT_M);
	setSliderHandle(state.host.querySelector('[data-slider="mass"]'), massRatio);
	setSliderHandle(state.host.querySelector('[data-slider="height"]'), heightRatio);
}

function setSliderHandle(slider, ratio)
{
	const trackHeight = slider.offsetHeight || 370;
	const top = (1 - Math.max(0, Math.min(1, ratio))) * trackHeight;
	slider.querySelector(".slider-handle").style.top = `${top}px`;
}

function updateConstructScene(state, frame, speed)
{
	const { car, background } = state.construct;
	if (background)
		background.animationFrame = getPlanet(state).frame;

	if (!car)
		return;

	const animationName = `${getMass(state)}kg`;
	if (car.animationName !== animationName)
		car.setAnimation(animationName, "current-frame");

	state.targetFrame = clampFrame(frame);
	if (state.phase === "running")
		updateVisualFrame(state);
	else
	{
		state.visualFrame = state.targetFrame;
		state.targetFrame = state.visualFrame;
		state.visualFrameSpeed = 0;
		state.lastAppliedFrame = -1;
		state.lastVisualTime = performance.now();
	}

	car.stopAnimation();
	if (car.animationSpeed !== 0)
		car.animationSpeed = 0;

	const visualFrame = Math.round(state.visualFrame);
	if (state.lastAppliedFrame !== visualFrame || Math.round(car.animationFrame) !== visualFrame)
	{
		car.animationFrame = visualFrame;
		state.lastAppliedFrame = visualFrame;
	}

	state.lastMeasuredFrame = visualFrame;
}

function updateVisualFrame(state)
{
	const now = performance.now();
	const dt = Math.min(0.033, Math.max(0, (now - state.lastVisualTime) / 1000 || 1 / 60));
	state.lastVisualTime = now;

	const delta = state.targetFrame - state.visualFrame;
	const easedStep = delta * (1 - Math.exp(-VISUAL_FRAME_CATCHUP * dt));
	const maxStep = VISUAL_MAX_FRAME_STEP * Math.max(1, dt / (1 / 60));
	const step = Math.max(-maxStep, Math.min(maxStep, easedStep));

	if (Math.abs(delta) <= 0.02)
		state.visualFrame = state.targetFrame;
	else
		state.visualFrame += step;

	state.visualFrameSpeed = Math.abs(step) / Math.max(dt, 1 / 120);
}

function updateStandaloneScene(state, frame)
{
	if (state.runtime)
		return;

	const planet = getPlanet(state);
	const mass = getMass(state);
	const assetFrame = Math.round(clampFrame(frame));
	state.bg.src = asset(`images/background-default-00${planet.frame}.png`);
	state.car.src = asset(`images/arac-${mass}kg-${String(assetFrame).padStart(3, "0")}.png`);

	const t = assetFrame / FRAME_MAX;
	state.car.style.left = `${355 + (1210 * t)}px`;
	state.car.style.top = `${245 + (555 * Math.sin(Math.PI * t))}px`;
}

function drawChart(state, values)
{
	const ctx = state.chart.getContext("2d");
	const width = state.chart.width;
	const height = state.chart.height;
	const plot = { left: 44, top: 12, right: 12, bottom: 28 };
	const plotW = width - plot.left - plot.right;
	const plotH = height - plot.top - plot.bottom;
	const bars = [
		["KE", values.ke, "#4c78a8"],
		["PE", values.pe, "#59a14f"],
		["Isı", values.heat, "#e15759"],
		["Toplam", values.total, "#f28e2b"]
	];

	ctx.clearRect(0, 0, width, height);
	ctx.strokeStyle = "#cdd4dc";
	ctx.lineWidth = 1;
	ctx.font = "14px Calibri, Arial, sans-serif";
	ctx.fillStyle = "#7b8795";

	for (let i = 0; i <= 4; i++)
	{
		const y = plot.top + plotH - (plotH * i / 4);
		ctx.beginPath();
		ctx.setLineDash(i ? [4, 4] : []);
		ctx.moveTo(plot.left, y);
		ctx.lineTo(width - plot.right, y);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillText(String(i), 18, y + 4);
	}

	const barW = plotW / bars.length * 0.54;
	bars.forEach((bar, index) =>
	{
		const ratio = values.total ? Math.max(0, Math.min(1, bar[1] / values.total)) : 0;
		const x = plot.left + (plotW / bars.length) * index + (plotW / bars.length - barW) / 2;
		const barH = ratio * plotH;
		ctx.fillStyle = bar[2];
		ctx.fillRect(x, plot.top + plotH - barH, barW, barH);
		ctx.fillStyle = "#7b8795";
		ctx.textAlign = "center";
		ctx.fillText(bar[0], x + barW / 2, height - 8);
	});

	ctx.textAlign = "left";
}

function getConstructObjects(runtime)
{
	if (!runtime)
		return {};

	return {
		car: runtime.objects.arac?.getFirstInstance?.() || null,
		background: runtime.objects.background?.getFirstInstance?.() || null
	};
}

function getPlanet(state)
{
	return PLANETS.find(planet => planet.key === state.planetKey) || PLANETS[0];
}

function getMass(state)
{
	return MASS_VALUES[state.massIndex] || MASS_VALUES[0];
}

function initialEnergy(state)
{
	return getMass(state) * getPlanet(state).g * state.heightM;
}

function potentialEnergy(state)
{
	return getMass(state) * getPlanet(state).g * heightFromTheta(state.theta);
}

function getTurnFrameLimits(state)
{
	if (!state.friction)
		return { left: 0, right: FRAME_MAX };

	const limitedHeight = reachableHeightFromEnergy(state);

	return {
		left: frameFromTheta(thetaFromHeight(limitedHeight, -1, 0)),
		right: frameFromTheta(thetaFromHeight(limitedHeight, 1, 0))
	};
}

function reachableHeightFromEnergy(state)
{
	const mechanicalEnergy = Math.max(0, initialEnergy(state) - state.heat);
	return Math.max(0, Math.min(MAX_HEIGHT_M, mechanicalEnergy / (getMass(state) * getPlanet(state).g)));
}

function thetaFromHeight(heightM, side, minHeight = MIN_HEIGHT_M)
{
	const clampedHeight = Math.max(minHeight, Math.min(MAX_HEIGHT_M, heightM));
	const sinTheta = 1 - (clampedHeight / MAX_HEIGHT_M);
	const angle = Math.asin(Math.max(-1, Math.min(1, sinTheta)));
	return side < 0 ? Math.PI - angle : angle;
}

function heightFromTheta(theta)
{
	return MAX_HEIGHT_M * (1 - Math.sin(theta));
}

function frameFromTheta(theta)
{
	return Math.round(frameFloatFromTheta(theta));
}

function frameFloatFromTheta(theta)
{
	return Math.max(0, Math.min(FRAME_MAX, ((Math.PI - theta) / Math.PI) * FRAME_MAX));
}

function thetaFromFrame(frame)
{
	return Math.PI - ((clampFrame(frame) / FRAME_MAX) * Math.PI);
}

function clampFrame(frame)
{
	return Math.max(0, Math.min(FRAME_MAX, Number(frame) || 0));
}

function updateScale(state)
{
	const scale = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
	state.stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
	if (!state.runtime)
		state.host.querySelector(".energy-standalone-scene").style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function formatNumber(value)
{
	return Number(value).toFixed(1);
}

function showPlanetInfo(state)
{
	const planet = getPlanet(state);
	const popover = state.host.querySelector(".info-popover");
	popover.textContent = `${planet.name}: g = ${planet.g.toFixed(2)} m/s²`;
	popover.classList.add("is-open");
	clearTimeout(state.infoTimer);
	state.infoTimer = setTimeout(() => popover.classList.remove("is-open"), 1800);
}

async function shareSimulation()
{
	const text = "Enerjinin Korunumu simülasyonu";
	if (navigator.share)
		await navigator.share({ title: text, text }).catch(() => {});
	else
		navigator.clipboard?.writeText(location.href).catch(() => {});
}

function toggleFullscreen()
{
	if (document.fullscreenElement)
		document.exitFullscreen?.();
	else
		document.documentElement.requestFullscreen?.();
}

function asset(path)
{
	return new URL(`../${path}`, import.meta.url).href;
}

function injectEnergyStyles()
{
	if (document.getElementById("energy-conservation-style"))
		return;

	const style = document.createElement("style");
	style.id = "energy-conservation-style";
	style.textContent = `
		#energy-conservation-host {
			position: fixed;
			inset: 0;
			z-index: 2147483647;
			overflow: hidden;
			font-family: Calibri, Arial, sans-serif;
			color: #2d2f33;
			pointer-events: none;
		}

		.energy-stage,
		.energy-standalone-scene {
			position: absolute;
			left: 50%;
			top: 50%;
			width: ${GAME_WIDTH}px;
			height: ${GAME_HEIGHT}px;
			transform-origin: center center;
			pointer-events: none;
		}

		.energy-standalone-scene {
			background: #111820;
		}

		.energy-bg {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		.energy-car {
			position: absolute;
			transform: translate(-50%, -50%);
			will-change: left, top;
		}

		.metric-value {
			position: absolute;
			height: 48px;
			text-align: center;
			font-size: 38px;
			font-weight: 900;
			line-height: 1;
			letter-spacing: 0;
			white-space: nowrap;
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
		}

		.planet-zone {
			position: absolute;
			width: 110px;
			height: 110px;
			border: 5px solid transparent;
			border-radius: 17px;
			background: transparent;
			cursor: pointer;
			pointer-events: auto;
		}

		.planet-zone.is-selected {
			border-color: #18ef18;
		}

		.construct-chart {
			position: absolute;
			left: 16px;
			top: 761px;
			width: 244px;
			height: 146px;
			pointer-events: none;
		}

		.friction-toggle {
			position: absolute;
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-weight: 900;
			line-height: 1.2;
			pointer-events: auto;
			cursor: pointer;
		}

		.construct-friction {
			left: 178px;
			top: 947px;
			width: 82px;
			height: 40px;
		}

		.standalone-friction {
			left: 16px;
			right: 16px;
			bottom: 14px;
			font-size: 24px;
		}

		.friction-toggle input {
			position: absolute;
			opacity: 0;
		}

		.friction-toggle i {
			width: 80px;
			height: 38px;
			border: 2px solid #7d8792;
			border-radius: 999px;
			background: #ef5350;
			box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.22);
		}

		.friction-toggle i::after {
			content: "";
			display: block;
			width: 33px;
			height: 33px;
			margin: 1px;
			border-radius: 50%;
			background: #e8e8e8;
			box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
			transition: transform 140ms ease;
		}

		.friction-toggle input:checked + i {
			background: #14a25b;
		}

		.friction-toggle input:checked + i::after {
			transform: translateX(41px);
		}

		.construct-run-buttons {
			position: absolute;
			left: 1692px;
			top: 238px;
			width: 210px;
			display: grid;
			gap: 10px;
			pointer-events: auto;
		}

		.start-button,
		.reset-button {
			height: 66px;
			border: 0;
			border-radius: 10px;
			color: #ffffff;
			font: 900 22px/1 Calibri, Arial, sans-serif;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			cursor: pointer;
			box-shadow: 0 4px 10px rgba(0, 0, 0, 0.16);
		}

		.start-button {
			background: #12a35a;
		}

		.start-button.is-running {
			background: #d63b36;
		}

		.start-button.is-paused {
			background: #f2a51f;
		}

		.reset-button {
			background: #465468;
		}

		.start-button svg,
		.reset-button svg {
			width: 29px;
			height: 29px;
			fill: none;
			stroke: currentColor;
			stroke-width: 2.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.start-button:active,
		.reset-button:active,
		.planet-zone:active {
			transform: translateY(2px);
		}

		.slider-readout {
			position: absolute;
			top: 410px;
			width: 94px;
			height: 54px;
			padding: 0;
			border-radius: 7px;
			background: #e6f3ff;
			display: grid;
			place-items: center;
			font-size: 24px;
			font-weight: 900;
			white-space: nowrap;
			pointer-events: none;
		}

		.slider-readout.mass {
			left: 1692px;
		}

		.slider-readout.height {
			left: 1808px;
		}

		.slider-control {
			position: absolute;
			top: 514px;
			width: 76px;
			height: 370px;
			pointer-events: auto;
		}

		.slider-control.mass {
			left: 1704px;
		}

		.slider-control.height {
			left: 1817px;
		}

		.slider-control input {
			position: absolute;
			left: -147px;
			top: 166px;
			width: 370px;
			height: 38px;
			transform: rotate(-90deg);
			opacity: 0;
			cursor: pointer;
		}

		.slider-handle {
			position: absolute;
			left: 7px;
			width: 62px;
			height: 62px;
			margin-top: -31px;
			border: 2px solid #9a9a9a;
			border-radius: 50%;
			background: linear-gradient(#eeeeee, #d0d0d0);
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
			pointer-events: none;
		}

		.info-popover {
			position: absolute;
			right: 270px;
			top: 186px;
			min-width: 230px;
			padding: 14px 18px;
			border-radius: 8px;
			background: rgba(23, 31, 42, 0.9);
			color: #ffffff;
			font-size: 22px;
			font-weight: 800;
			opacity: 0;
			transform: translateY(-8px);
			transition: opacity 140ms ease, transform 140ms ease;
			pointer-events: none;
		}

		.info-popover.is-open {
			opacity: 1;
			transform: translateY(0);
		}

		.standalone-metric-cards {
			position: absolute;
			left: 75px;
			top: 29px;
			display: flex;
			pointer-events: none;
		}

		.metric-card {
			width: 195px;
			height: 81px;
			margin-left: -1px;
			border-radius: 18px;
			background: linear-gradient(#ececec, #b8b8b8);
			box-shadow: 0 7px 18px rgba(0, 0, 0, 0.35);
			display: grid;
			grid-template-rows: 32px 1fr;
			place-items: center;
			overflow: hidden;
		}

		.metric-card.is-wide {
			width: 240px;
		}

		.metric-card span {
			font-size: 24px;
			font-weight: 800;
		}

		.metric-card strong {
			font-size: 38px;
			font-weight: 900;
			white-space: nowrap;
		}

		.standalone-top-actions {
			position: absolute;
			right: 24px;
			top: 23px;
			display: flex;
			gap: 18px;
			pointer-events: auto;
		}

		.round-tool {
			width: 90px;
			height: 90px;
			border: 2px solid rgba(255, 255, 255, 0.95);
			border-radius: 50%;
			background: radial-gradient(circle at 35% 25%, #fbfbfd 0%, #eceef2 55%, #b9bec7 100%);
			box-shadow: 0 6px 15px rgba(0, 0, 0, 0.28), inset 0 2px 4px rgba(255, 255, 255, 0.9);
			color: #3d3b45;
			cursor: pointer;
			display: grid;
			place-items: center;
			padding: 0;
		}

		.round-tool svg {
			width: 48px;
			height: 48px;
			fill: none;
			stroke: currentColor;
			stroke-width: 2.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.standalone-planets {
			position: absolute;
			left: 40px;
			top: 268px;
			display: flex;
			flex-direction: column;
			gap: 12px;
			pointer-events: none;
		}

		.standalone-planet-button {
			width: 110px;
			height: 110px;
			padding: 0;
			border: 5px solid transparent;
			border-radius: 17px;
			background: #f5f5f5;
			box-shadow: 0 3px 8px rgba(0, 0, 0, 0.22);
		}

		.standalone-planet-button img {
			width: 100%;
			height: 100%;
			display: block;
			object-fit: cover;
			border-radius: 12px;
		}

		.standalone-graph {
			position: absolute;
			left: 0;
			bottom: 77px;
			width: 276px;
			height: 290px;
			border-radius: 0 13px 13px 0;
			background: linear-gradient(#f7f7f7 0 72%, rgba(222, 222, 222, 0.92) 72% 100%);
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
			overflow: hidden;
			pointer-events: none;
		}

		.standalone-graph .energy-chart {
			position: absolute;
			left: 16px;
			top: 49px;
			width: 244px;
			height: 146px;
		}

		.graph-title {
			height: 39px;
			display: flex;
			align-items: center;
			gap: 7px;
			padding-left: 8px;
			border-bottom: 1px solid #e1e4e8;
			font-size: 13px;
			font-weight: 800;
			color: #1e2730;
		}

		.graph-title svg {
			width: 14px;
			height: 14px;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
		}

		.standalone-panel {
			position: absolute;
			right: 0;
			top: 202px;
			width: 270px;
			height: 834px;
			border-radius: 28px 0 0 28px;
			background: linear-gradient(#eff3f7 0 160px, rgba(176, 180, 184, 0.95) 160px 695px, #f4f4f4 695px 100%);
			box-shadow: -4px 0 24px rgba(0, 0, 0, 0.38);
			pointer-events: none;
		}

		.standalone-panel .construct-run-buttons {
			left: 22px;
			top: 20px;
		}

		.standalone-panel .slider-readout {
			top: 184px;
		}

		.standalone-panel .slider-readout.mass {
			left: 42px;
		}

		.standalone-panel .slider-readout.height {
			left: 158px;
		}

		.standalone-panel .slider-control {
			top: 241px;
		}

		.standalone-panel .slider-control.mass {
			left: 54px;
		}

		.standalone-panel .slider-control.height {
			left: 167px;
		}

		.standalone-slider-label {
			position: absolute;
			top: 694px;
			width: 96px;
			text-align: center;
			font-size: 26px;
			font-weight: 900;
			line-height: 1.05;
			pointer-events: none;
		}

		.standalone-slider-label.mass {
			left: 42px;
		}

		.standalone-slider-label.height {
			left: 153px;
		}
	`;
	document.head.appendChild(style);
}

function iconPlay(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg>`;}
function iconUndo(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5v4"/><path d="M5 11a7 7 0 1 0 2-5"/></svg>`;}
function iconRefresh(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.4 6.4"/><path d="M3 12A9 9 0 0 1 18.4 5.6"/><path d="M18 2v5h-5"/><path d="M6 22v-5h5"/></svg>`;}
function iconSound(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="m18 9 4 4"/><path d="m22 9-4 4"/></svg>`;}
function iconList(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`;}
function iconShare(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/></svg>`;}
function iconFullscreen(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;}
function iconChart(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/></svg>`;}

globalThis.C3_ProjectMainScriptOK = true;
