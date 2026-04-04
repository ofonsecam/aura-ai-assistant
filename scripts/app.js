// Selectors for form, input, and task list
const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const taskList = document.getElementById("task-list");

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