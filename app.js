/* ==========================
   DIEZ DE - app.js (FAMILIAR)
   - Sin modo adulto: sin PIN, sin botón, sin 1-adulta-por-ronda
   - UI: Iniciar arriba; Repetir/Sugerir/Terminar fuera del cuadro de consignas
   - Música: playlist /musica + fade + ON/OFF (recuerda estado)
   - Volumen: SIEMPRE arranca 15% (no recuerda vol)
   - Fullscreen opcional
   - Sugerencias por JSONP (sin CORS)
   - Banner actualización (SW)
   - WakeLock
========================== */
if (typeof gtag === "function") {
  gtag('event', 'open_app', {
    installed: isStandalone() ? 'yes' : 'no'
  });
}


// ====== CONFIG ======
const TIEMPO_ESCRITURA = 70;
const PAUSA_LECTURA_MS = 650;
const PAUSA_REPASO_MS = 500;

// ✅ PEGÁ TU WEBAPP /exec AQUÍ
const SUGERENCIAS_API_URL = "https://script.google.com/macros/s/AKfycbw_PA0H-NzujxdJwRvykqc_IAlBPLW0lhne0zpgFOTGUn1Fw-G1UYRJ0m4QsSYZQzhEfQ/exec";

// ✅ Playlist (carpeta /musica)
const PLAYLIST = [
  "musica/track1.mp3",
  "musica/track2.mp3",
  "musica/track3.mp3",
  "musica/track4.mp3",
];

// Música: recuerda ON/OFF, pero VOL SIEMPRE 15%
const MUSIC_ON_KEY = "diezde_musica";
const DEFAULT_MUSIC_VOL = 0.15;

// ====== DATA base (consignas.js) ======
let CONSIGNAS_GENERALES = Array.isArray(window.CONSIGNAS_GENERALES) ? window.CONSIGNAS_GENERALES : [];

// ====== UI ======
const btnIniciar = document.getElementById("btnIniciar");
const btnRepetir = document.getElementById("btnRepetir");
const btnTerminar = document.getElementById("btnTerminar");
const btnFullscreen = document.getElementById("btnFullscreen");
const btnMusica = document.getElementById("btnMusica");
const btnPrevTrack = document.getElementById("btnPrevTrack");
const btnNextTrack = document.getElementById("btnNextTrack");

const estado = document.getElementById("estado");
const timerEl = document.getElementById("timer");
const vistaLectura = document.getElementById("vistaLectura");
const vistaRespuesta = document.getElementById("vistaRespuesta");
const listaEl = document.getElementById("listaConsignas");

const musicaFondo = document.getElementById("musicaFondo");

// Slider volumen
const musicVolume = document.getElementById("musicVolume");
const musicVolumeLabel = document.getElementById("musicVolumeLabel");

// Update banner (SW)
const updateBanner = document.getElementById("updateBanner");
const btnUpdateNow = document.getElementById("btnUpdateNow");

// Sugerencias (modal)
const btnSugerirAbrir = document.getElementById("btnSugerirAbrir");
const modalSugerencia = document.getElementById("modalSugerencia");
const btnSugerirCerrar = document.getElementById("btnSugerirCerrar");
const inputSugerencia = document.getElementById("inputSugerencia");
const selectCategoria = document.getElementById("selectCategoria");
const btnEnviarSugerencia = document.getElementById("btnEnviarSugerencia");
const sugerenciaMsg = document.getElementById("sugerenciaMsg");

// ====== STATE ======
let ronda = [];
let ultimaRondaIDs = [];
let timerId = null;
let wakeLock = null;

let musicaActiva = false;
let fadeInterval = null;

// Playlist state
let playlistIndex = Math.floor(Math.random() * PLAYLIST.length);
let userGestureUnlocked = false;

// ====== helpers ======
function show(el){ if(el) el.classList.remove("hidden"); }
function hide(el){ if(el) el.classList.add("hidden"); }
function limpiarTexto(t){ return String(t || "").replace(/\s+/g," ").trim(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function cancelarVoz(){
  try{ if("speechSynthesis" in window) speechSynthesis.cancel(); }catch(e){}
}

function hablar(texto){
  return new Promise(res=>{
    if(!("speechSynthesis" in window)){ res(); return; }
    const u = new SpeechSynthesisUtterance(limpiarTexto(texto));
    u.lang = "es-AR";
    u.rate = 1;
    u.volume = 1; // ✅ VOZ SIEMPRE 100%
    u.onend = res;
    u.onerror = res;
    speechSynthesis.speak(u);
  });
}

function renderLectura(items){
  if(!listaEl) return;
  listaEl.innerHTML = "";
  items.forEach(c=>{
    const li = document.createElement("li");
    li.textContent = c.texto;
    listaEl.appendChild(li);
  });
}

// ====== WakeLock ======
async function activarWakeLock(){
  try{
    if("wakeLock" in navigator){
      wakeLock = await navigator.wakeLock.request("screen");
    }
  }catch(e){}
}
function liberarWakeLock(){
  try{
    if(wakeLock){
      wakeLock.release();
      wakeLock = null;
    }
  }catch(e){}
}

// ====== Fullscreen ======
async function toggleFullscreen(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen();
    }else{
      await document.exitFullscreen();
    }
  }catch(e){}
}
function setBtnFullscreenUI(){
  if(!btnFullscreen) return;
  const enFS = !!document.fullscreenElement;
  btnFullscreen.textContent = enFS ? "Salir Fullscreen" : "Fullscreen";
}

// ====== Música (playlist) + fade + recuerda estado + volumen ======
function setBtnMusicaUI(){
  if(!btnMusica) return;
  btnMusica.setAttribute("aria-pressed", musicaActiva ? "true" : "false");
  btnMusica.textContent = musicaActiva ? "🔊 Música" : "🎵 Música";
}

function setMusicVol(vol){
  const v = clamp(vol, 0, 1);
  if(musicaFondo) musicaFondo.volume = v;

  if(musicVolume) musicVolume.value = String(Math.round(v * 100));
  if(musicVolumeLabel) musicVolumeLabel.textContent = `${Math.round(v * 100)}%`;
}

function getUIVol(){
  const v = Number(musicVolume?.value ?? 15) / 100;
  return clamp(v, 0, 1);
}

function setTrack(i){
  if(!musicaFondo) return;
  playlistIndex = (i + PLAYLIST.length) % PLAYLIST.length;
  musicaFondo.src = PLAYLIST[playlistIndex];
}
function nextTrack(){
  if(!musicaFondo) return;
  setTrack(playlistIndex + 1);
  if(musicaActiva) playMusica();
}

function prevTrack(){
  if(!musicaFondo) return;

  try{
    if(!musicaFondo.paused && musicaFondo.currentTime > 2){
      musicaFondo.currentTime = 0;
      return;
    }
  }catch(e){}

  setTrack(playlistIndex - 1);
  if(musicaActiva) playMusica();
}

function fadeTo(target, ms = 350){
  if(!musicaFondo) return;
  clearInterval(fadeInterval);

  const start = typeof musicaFondo.volume === "number" ? musicaFondo.volume : 0;
  const steps = 18;
  const stepMs = Math.max(12, Math.floor(ms / steps));
  let i = 0;

  fadeInterval = setInterval(()=>{
    i++;
    const v = start + (target - start) * (i / steps);
    musicaFondo.volume = clamp(v, 0, 1);

    if(i >= steps){
      clearInterval(fadeInterval);
      fadeInterval = null;
      if(target === 0) musicaFondo.pause();
    }
  }, stepMs);
}

function playMusica(){
  if(!musicaFondo) return;
  if(!userGestureUnlocked) return;

  if(!musicaFondo.src) setTrack(playlistIndex);

  musicaFondo.volume = 0;
  musicaFondo.play().catch(()=>{});
  fadeTo(getUIVol(), 450);
}

function pauseMusica(){
  if(!musicaFondo) return;
  fadeTo(0, 250);
}

function toggleMusica(){
  musicaActiva = !musicaActiva;
  localStorage.setItem(MUSIC_ON_KEY, musicaActiva ? "1" : "0");
  setBtnMusicaUI();
  if(musicaActiva) playMusica();
  else pauseMusica();
}

function restoreMusicaPref(){
  musicaActiva = localStorage.getItem(MUSIC_ON_KEY) === "1";
  setBtnMusicaUI();

  setMusicVol(DEFAULT_MUSIC_VOL);

  if(musicaFondo){
    setTrack(playlistIndex);
    musicaFondo.loop = false;

    musicaFondo.addEventListener("ended", ()=>{
      setTrack(playlistIndex + 1);
      if(musicaActiva) playMusica();
    });
  }
}

// ====== Selección ronda (SIEMPRE 10 generales) ======
function normalizarLista(base){
  return (Array.isArray(base)? base : [])
    .map(x => ({
      id: Number(x.id),
      texto: limpiarTexto(x.texto),
      categoria: (x.categoria ? String(x.categoria) : "GENERAL")
    }))
    .filter(x => x.id && x.texto.length > 0);
}

function seleccionarRonda(){
  const generales = normalizarLista(CONSIGNAS_GENERALES);

  let pool = generales.filter(c => !ultimaRondaIDs.includes(c.id));
  if(pool.length < 10) pool = generales;

  const seleccion = shuffle(pool).slice(0, 10);
  ultimaRondaIDs = seleccion.map(c => c.id);
  return seleccion;
}

// ====== Timer ======
function detenerTimer(){
  if(timerId){
    clearInterval(timerId);
    timerId = null;
  }
}

function iniciarTimer(){
  detenerTimer();
  let t = TIEMPO_ESCRITURA;
  if(timerEl) timerEl.textContent = t;

  timerId = setInterval(()=>{
    t--;
    if(timerEl) timerEl.textContent = t;
    if(t <= 0){
      detenerTimer();
      terminarRonda();
    }
  }, 1000);
}

// ====== Flujo ======
async function iniciarRonda(){
  if(!Array.isArray(CONSIGNAS_GENERALES) || CONSIGNAS_GENERALES.length < 10){
    if(estado) estado.textContent = "Faltan consignas (revisá consignas.js)";
    return;
  }

  userGestureUnlocked = true;

  cancelarVoz();
  pauseMusica();

  await activarWakeLock();

  ronda = seleccionarRonda();
  renderLectura(ronda);

  show(vistaLectura);
  hide(vistaRespuesta);

  show(btnTerminar);

  if(estado) estado.textContent = "Escuchá…";

  for(let i=0;i<ronda.length;i++){
    await hablar(`${i+1}. ${ronda[i].texto}`);
    await sleep(PAUSA_LECTURA_MS);
  }

  await hablar("Repasamos");
  for(const c of ronda){
    await hablar(c.texto);
    await sleep(PAUSA_REPASO_MS);
  }

  hide(vistaLectura);
  show(vistaRespuesta);

  if(estado) estado.textContent = "¡A escribir de memoria!";
  iniciarTimer();
}

function terminarRonda(){
  detenerTimer();
  cancelarVoz();

  hide(vistaRespuesta);
  show(vistaLectura);
  renderLectura(ronda);

  hide(btnTerminar);
  if(estado) estado.textContent = "Tiempo – corrigen respuestas";

  liberarWakeLock();

  if(musicaActiva) playMusica();
  hablar("Tiempo");
}

async function repetirConsignas(){
  if(!ronda || ronda.length === 0) return;
  cancelarVoz();
  pauseMusica();

  await hablar("Repasamos");
  for(const c of ronda){
    await hablar(c.texto);
    await sleep(PAUSA_REPASO_MS);
  }
}

// ====== JSONP (SIN CORS) ======
function jsonp(url, timeoutMs = 9000){
  return new Promise((resolve, reject)=>{
    const cb = `cb_${Date.now()}_${Math.floor(Math.random()*99999)}`;

    const cleanup = ()=>{
      try{ delete window[cb]; }catch(e){}
      if(script && script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(to);
    };

    window[cb] = (data)=>{
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(cb);
    script.onerror = ()=>{
      cleanup();
      reject(new Error("jsonp_error"));
    };

    const to = setTimeout(()=>{
      cleanup();
      reject(new Error("jsonp_timeout"));
    }, timeoutMs);

    document.head.appendChild(script);
  });
}

// ====== Sugerencias ======
function abrirSugerencias(){
  if(!modalSugerencia) return;
  if(inputSugerencia) inputSugerencia.value = "";
  if(selectCategoria) selectCategoria.value = "GENERAL";
  if(sugerenciaMsg) { sugerenciaMsg.classList.add("hidden"); sugerenciaMsg.textContent=""; }
  show(modalSugerencia);
  setTimeout(()=>{ try{ inputSugerencia?.focus(); }catch(e){} }, 50);
}
function cerrarSugerencias(){ hide(modalSugerencia); }

function msgSugerencia(texto, tipo=""){
  if(!sugerenciaMsg) return;
  sugerenciaMsg.textContent = texto;
  sugerenciaMsg.classList.remove("hidden");
  sugerenciaMsg.classList.remove("ok","err");
  if(tipo) sugerenciaMsg.classList.add(tipo);
}

async function enviarSugerencia(){
  const texto = limpiarTexto(inputSugerencia?.value);
  const categoria = (selectCategoria?.value || "GENERAL").toUpperCase();

  if(texto.length < 4){
    msgSugerencia("Escribí una consigna un poquito más larga 🙂","err");
    return;
  }

  if(!SUGERENCIAS_API_URL || SUGERENCIAS_API_URL.includes("PEGAR_ACA")){
    msgSugerencia("Falta configurar la URL de sugerencias (Apps Script).","err");
    return;
  }

  msgSugerencia("Enviando…");

  const url =
    `${SUGERENCIAS_API_URL}?action=sugerir` +
    `&texto=${encodeURIComponent(texto)}` +
    `&categoria=${encodeURIComponent(categoria)}`;

  try{
    const data = await jsonp(url);
    if(data && data.ok){
      msgSugerencia("¡Gracias por la sugerencia! 🙌 La vamos a revisar.","ok");
      if(inputSugerencia) inputSugerencia.value = "";
    }else{
      msgSugerencia("No se pudo enviar. Probá otra vez.","err");
    }
  }catch(e){
    msgSugerencia("Error de conexión. Probá otra vez.","err");
  }
}

// ====== Cargar aprobadas (solo GENERAL) ======
async function cargarAprobadas(){
  if(!SUGERENCIAS_API_URL || SUGERENCIAS_API_URL.includes("PEGAR_ACA")) return;

  try{
    const urlG = `${SUGERENCIAS_API_URL}?action=aprobadas&cat=GENERAL`;
    const g = await jsonp(urlG).catch(()=>[]);

    const baseG = new Map((CONSIGNAS_GENERALES||[]).map(x => [Number(x.id), x]));
    (Array.isArray(g)?g:[]).forEach(x=>{
      const id = Number(x.id);
      const texto = limpiarTexto(x.texto);
      if(id && texto && !baseG.has(id)) baseG.set(id, {id, texto, categoria:"GENERAL"});
    });
    CONSIGNAS_GENERALES = Array.from(baseG.values());

  }catch(e){}
}

// ====== UPDATE BANNER (SW) ======
let newSW = null;
function showUpdateBanner(){
  if(!updateBanner || !btnUpdateNow) return;
  updateBanner.classList.remove("hidden");
  btnUpdateNow.onclick = () => {
    if (newSW) newSW.postMessage({ type: "SKIP_WAITING" });
    location.reload();
  };
}

function initServiceWorker(){
  if(!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async ()=>{
    try{
      const reg = await navigator.serviceWorker.register("./sw.js");

      if(reg.waiting){
        newSW = reg.waiting;
        showUpdateBanner();
      }

      reg.addEventListener("updatefound", ()=>{
        const sw = reg.installing;
        if(!sw) return;

        sw.addEventListener("statechange", ()=>{
          if(sw.state === "installed" && navigator.serviceWorker.controller){
            newSW = sw;
            showUpdateBanner();
          }
        });
      });

      setInterval(()=> reg.update(), 5*60*1000);

    }catch(e){}
  });
}

// ====== INIT ======
(function init(){
  if(timerEl) timerEl.textContent = TIEMPO_ESCRITURA;

  setBtnFullscreenUI();
  restoreMusicaPref();
  setBtnMusicaUI();

  // volumen: siempre 15 al cargar, pero el usuario puede moverlo
  if(musicVolume){
    musicVolume.value = String(Math.round(DEFAULT_MUSIC_VOL * 100));
    if(musicVolumeLabel) musicVolumeLabel.textContent = `${musicVolume.value}%`;

    musicVolume.addEventListener("input", ()=>{
      const v = clamp(Number(musicVolume.value)/100, 0, 1);
      setMusicVol(v);
    });
  }

  cargarAprobadas();

  modalSugerencia?.addEventListener("click", (ev)=>{
    if(ev.target === modalSugerencia) cerrarSugerencias();
  });

  initServiceWorker();
})();

// ====== EVENTS ======
btnIniciar?.addEventListener("click", iniciarRonda);
btnRepetir?.addEventListener("click", repetirConsignas);
btnTerminar?.addEventListener("click", terminarRonda);

btnFullscreen?.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", setBtnFullscreenUI);

btnMusica?.addEventListener("click", ()=>{
  userGestureUnlocked = true;
  toggleMusica();
});

document.addEventListener("click", ()=>{
  userGestureUnlocked = true;
  if(musicaActiva && musicaFondo && musicaFondo.paused){
    playMusica();
  }
},{ once:true });

btnSugerirAbrir?.addEventListener("click", abrirSugerencias);
btnSugerirCerrar?.addEventListener("click", cerrarSugerencias);
btnEnviarSugerencia?.addEventListener("click", enviarSugerencia);

// 🎵 Anterior / Siguiente canción
btnNextTrack?.addEventListener("click", ()=>{
  userGestureUnlocked = true;
  nextTrack();
});

btnPrevTrack?.addEventListener("click", ()=>{
  userGestureUnlocked = true;
  prevTrack();
});

// ✅ INSTRUCCIONES (ARREGLADO: esperar DOM listo + no romper si falta algo)
document.addEventListener("DOMContentLoaded", () => {
  const btnInstr = document.getElementById("btnInstrucciones");
  const modalInstr = document.getElementById("modalInstrucciones");
  const cerrarInstr = document.getElementById("cerrarInstrucciones");

  if(!btnInstr || !modalInstr || !cerrarInstr){
    console.warn("Instrucciones: faltan elementos en el DOM", { btnInstr, modalInstr, cerrarInstr });
    return;
  }

  btnInstr.onclick = () => modalInstr.classList.remove("hidden");
  cerrarInstr.onclick = () => modalInstr.classList.add("hidden");

  // cerrar tocando afuera (bonus)
  modalInstr.addEventListener("click", (ev)=>{
    if(ev.target === modalInstr) modalInstr.classList.add("hidden");
  });

  // cerrar con ESC (bonus)
  document.addEventListener("keydown", (ev)=>{
    if(ev.key === "Escape") modalInstr.classList.add("hidden");
  });
});
