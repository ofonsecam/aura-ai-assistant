// Selectors for form, input, and task list
const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const taskList = document.getElementById("task-list");
const recordBtn = document.getElementById("record-btn");
const toastNotification = document.getElementById("toast-notification");

/** @type {ReturnType<typeof setTimeout> | null} */
let toastHideTimer = null;

/**
 * Muestra un mensaje en la pastilla flotante y lo oculta a los 3 s.
 * @param {string} message
 * @param {"success" | "error"} type
 */
function showToast(message, type) {
    if (!toastNotification) return;
    if (toastHideTimer !== null) {
        clearTimeout(toastHideTimer);
        toastHideTimer = null;
    }
    toastNotification.textContent = message;
    toastNotification.classList.remove("hidden", "success", "error");
    toastNotification.classList.add(type === "success" ? "success" : "error");
    toastNotification.classList.remove("hidden");
    toastHideTimer = setTimeout(() => {
        toastNotification.classList.add("hidden");
        toastHideTimer = null;
    }, 3000);
}

/** @type {MediaRecorder | null} */
let mediaRecorder = null;
/** @type {MediaStream | null} */
let micStream = null;
/** @type {Blob[]} */
let audioChunks = [];

// Initialize tasks array from localStorage or as empty array
let tasks = JSON.parse(localStorage.getItem("tasks")) || [];

// Global event listener for form submission to add a new task
taskForm.addEventListener("submit", function(e) {
    e.preventDefault();
    const text = taskInput.value.trim();
    if (text) {
        const newTask = {
            id: Date.now(),
            text,
            completed: false
        };
        tasks.push(newTask);
        localStorage.setItem("tasks", JSON.stringify(tasks));
        taskInput.value = "";
        renderTasks();
    }
});

// Renders tasks in the DOM using classes (no inline styles; CSP-friendly style-src).
function renderTasks() {
    taskList.innerHTML = ""; // Clear the list
    tasks.forEach(task => {
        const li = document.createElement("li");
        li.dataset.id = `${task.id}`;
        const doneClass = task.completed ? " task-completed" : "";
        li.innerHTML = `
            <span class="task-text${doneClass}"></span>
            <button type="button" class="delete-btn" data-id="${task.id}" aria-label="Delete task">🗑️</button>
        `;
        li.querySelector(".task-text").textContent = task.text;
        taskList.appendChild(li);
    });
}

// Event Delegation for delete functionality on task list
taskList.addEventListener("click", function(e) {
    if (e.target.classList.contains("delete-btn")) {
        const idToDelete = Number(e.target.getAttribute("data-id"));
        tasks = tasks.filter(task => task.id !== idToDelete);
        localStorage.setItem("tasks", JSON.stringify(tasks));
        renderTasks();
    }
});

renderTasks();

/**
 * Envía el audio a Whisper + Notion; la API devuelve transcripción y página creada.
 * @param {Blob[]} chunks
 */
async function processVoiceRecording(chunks) {
    const blob = new Blob(chunks, { type: "audio/webm" });
    console.log("Audio Blob captured!");

    if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
    }
    mediaRecorder = null;
    audioChunks = [];
    recordBtn.classList.remove("recording");

    recordBtn.disabled = true;
    recordBtn.classList.add("voice-processing");
    recordBtn.setAttribute("aria-busy", "true");

    const formData = new FormData();
    formData.append("audioFile", blob, "recording.webm");

    try {
        const res = await fetch("/api/process-voice", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (res.status === 200) {
            showToast("Tarea guardada en Notion", "success");
        }
        console.log("Voice → Notion OK:", data.transcription, data.notion);
    } catch (err) {
        console.error("Voice processing failed:", err);
        showToast("Error al guardar la tarea", "error");
    } finally {
        recordBtn.disabled = false;
        recordBtn.classList.remove("voice-processing");
        recordBtn.removeAttribute("aria-busy");
    }
}

/**
 * Toggle voice recording: first click requests mic and starts MediaRecorder;
 * second click stops, builds an audio/webm Blob, and sends it for transcription.
 */
recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
    }

    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const options = MediaRecorder.isTypeSupported("audio/webm")
            ? { mimeType: "audio/webm" }
            : {};
        mediaRecorder = new MediaRecorder(micStream, options);
        audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", (e) => {
            if (e.data && e.data.size > 0) {
                audioChunks.push(e.data);
            }
        });

        mediaRecorder.addEventListener("stop", () => {
            void processVoiceRecording(audioChunks.slice());
        });

        mediaRecorder.start();
        recordBtn.classList.add("recording");
    } catch (err) {
        console.error("Microphone access failed:", err);
        recordBtn.classList.remove("recording");
    }
});