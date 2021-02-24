var serverUrl = '/api' //https://jsonplaceholder.typicode.com

var list = document.querySelector('#list')
var buttonAdd = document.querySelector('#buttonAdd')
var newItemText = document.querySelector('#newItemText')


function getData() {
	return fetch(`${serverUrl}/todos`)
		.then(response => response.json())
}

function updateTodoItem() {

}

function addTodoItem(item) {
	return fetch(`${serverUrl}/todos`, {
		method: 'POST',
		body: JSON.stringify(item)
	})
		.then(response => response.json())
}

function drawItem(todoItem) {
	var item = document.createElement('li')

	var checked = document.createElement('input')
	checked.type = 'checkbox'
	checked.checked = todoItem.completed
	item.appendChild(checked)
	
	var title = document.createElement('span')
	title.textContent = todoItem.title
	item.appendChild(title)


	list.appendChild(item)
	
}
function drawItems(data) {
	const todoItems = data.items
	const total = data.total
	document.getElementById('total').textContent = total.toString()

	for (let i = 0; i < todoItems.length; i++) {
		const todoItem = todoItems[i];
		drawItem(todoItem)
	}
}

function refreshItems() {
	getData().then(data => drawItems(data))
}

function newTodoItemHandler() {
	buttonAdd.disabled = true
	newItemText.disabled = true
	addTodoItem({
		title: newItemText.value,
		completed: false
	})
		.then(function () {
			buttonAdd.disabled = false
			newItemText.disabled = false
			newItemText.value = ''
			newItemText.focus()
		})
		.catch(function (e) {
			buttonAdd.disabled = false
			newItemText.disabled = false
			newItemText.value = ''
			newItemText.focus()
			alert(JSON.stringify(e))
		})
}

newItemText.addEventListener("keyup", function (event) {
	if (event.keyCode === 13) {
		event.preventDefault();
		newTodoItemHandler();
	}
});
buttonAdd.addEventListener('click', newTodoItemHandler)

window.onload = function () {
	newItemText.focus()
	refreshItems()
}