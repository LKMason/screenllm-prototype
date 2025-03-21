
import { GoogleGenerativeAI } from 'https://cdn.jsdelivr.net/npm/@google/generative-ai@0.24.0/+esm';
import { csv } from 'https://cdn.jsdelivr.net/npm/d3-fetch@3.0.1/+esm';
import * as marked from 'https://cdn.jsdelivr.net/npm/marked@15.0.7/+esm';

// NOTE: I tried to handle auto-scrolling with a ResizeObserver, but there were problems with execution order.

const SYSTEM_PROMPT = `Below are NCCN breast cancer screening guideline rules. 
The user will describe themselves or a patient and you will provide advice on cancer screening. 
Ask follow-up questions when necessary to provide an accurate answer. 
Rules are shown in SINGLE square brackets with a numerical ID. 
Cite EVERY SINGLE rule you apply using double square brackets and the numerical rule ID.
Cite more than one rule using consecutive valid citations (e.g. [[1.1]][[1.2]])
`
class Application {
  constructor() {
    this.initialize();
  }

  async initialize() {
    this.state = "NO_CHAT";

    this.elems = {
      main: document.getElementById("main"),
      containerMessages: document.getElementById("container-messages"),
      formMessage: document.getElementById("form-message"),
      inputMessage: document.getElementById("input-message"),
      formKey: document.getElementById("form-key"),
      inputKey: document.getElementById("input-key"),
      popupKey: document.getElementById("popup-key"),
      checkboxKeyRemember: document.getElementById("checkbox-remember-key")
    };

    this.ruleTree = await (await fetch("src/rule_tree.txt")).text();
    const ruleDescriptions = await csv("src/rule_descriptions.csv");
    this.ruleIndex = new Map(ruleDescriptions.map(d => [d.id, d.description]));

   

    this.elems.formKey.addEventListener("submit", e => {
      e.preventDefault();
      this.apiKey = this.elems.inputKey.value;
      if (this.elems.checkboxKeyRemember.checked) {
        localStorage.GEMINI_KEY = this.apiKey;
      }
      this.initModel();
      this.startChat();
      this.state = "READY";
      this.elems.popupKey.classList.add("hidden");
      
    })

    this.elems.formMessage.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitMessage(this.elems.inputMessage.value);
      this.elems.formMessage.reset();
    });

    this.elems.inputMessage.addEventListener('input', function () {
      this.style.height = 'auto'; 
      this.style.height = (this.scrollHeight+5) + 'px';
    });

    this.elems.inputMessage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.elems.formMessage.dispatchEvent(new Event('submit'));
      }
    });


    this.scrollAtBottom = true;
    this.elems.main.addEventListener("scroll", () => {
      this.scrollAtBottom = this.elems.main.scrollHeight - this.elems.main.scrollTop <= this.elems.main.clientHeight + 1;
    });

    if (!localStorage.GEMINI_KEY) {
      this.requestKey();
    } else {
      this.apiKey = localStorage.GEMINI_KEY;
      this.initModel();
      this.startChat();
    }

  }

  initModel() {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT + " \ n " + this.ruleTree
    });

  }

  startChat() {
    // Only a single chat for now.
    const chat = this.model.startChat();
    this.loadChat(chat);
  }

  requestKey() {
    this.elems.popupKey.classList.remove("hidden");
  }

  async loadChat(chat) {
    this.activeChat = chat;
    const history = await this.activeChat.getHistory();
    this.state = "READY";
    this.scrollMessageContainer();
    // TODO: Handle history.
  }

  async submitMessage(text) {
    if (this.state == "READY") {
      const userMessageElement =  document.createElement("div");
      userMessageElement.innerText = text;
      userMessageElement.classList.add("message-user");
      this.elems.containerMessages.appendChild(userMessageElement);
      this.scrollMessageContainer(); 

      this.state = "RESPONDING";
      try {
        const response =  await this.activeChat.sendMessageStream(text);
        const messageElement = this.createMessageElement("model", "");
        this.handleStreamResponse(response, messageElement);
      } catch (e) {
        if (e.errorDetails.some(d => d.reason == "API_KEY_INVALID")) {
          localStorage.removeItem("GEMINI_KEY");
          this.state = "NO_KEY";
          console.error("Invalid API key. Removed from localStorage.");
        }
      }
      
    } else {
      // TODO: Handle interruption.
    }
  }


  async handleStreamResponse(response, messageElement) {
    let text = "";
    for await (const chunk of response.stream) {
      // const text = this.formatMessage(chunk.text()); 
      const textChunk = chunk.text();
      text += textChunk;
      messageElement.innerHTML = this.messageTextToHTML(text);
      this.scrollMessageContainer(); 
    }
    console.log("Streamed Text:", text);
    this.hookTippies();
    this.state = "READY";
  }

  hookTippies() {
    const elements =document.querySelectorAll(".rule-citation");
    for (const element of elements) {
      const rule =  element.getAttribute("rule");
      const html = `<div class="flex flex-col"><b>Rule ${rule}</b> <p>${this.ruleIndex.get(rule)}</p></div>`

      tippy(element, {
        content: html,
        allowHTML: true
      })
    }
  }

  messageTextToHTML(text) {
    return marked.parse(text).replace(/\[\[(.*?)\]\]/g, '<i rule="$1"class="fas fa-info-circle rule-citation"></i>');
    // return text.replace(/\[\[(.*?)\]\]/g, '<i rule="$1"class="fas fa-info-circle rule-citation"></i>').replace(/\n/g, "<br>");
  }

  createMessageElement(role, text) {
    const messageElement = document.createElement("article");
    messageElement.classList.add("prose");
    messageElement.classList.add("message-" + role);
    messageElement.innerHTML = this.messageTextToHTML(text)
    this.elems.containerMessages.appendChild(messageElement);
    return messageElement;
  }

  updateMessages(messages) {
    this.elems.containerMessages.innerHTML = '';
    for (const message of messages) {
      this.createMessageElement(message.role, message.parts[0].text);
    }
    this.hookTippies();
  }
  
  scrollMessageContainer() {
    if (this.scrollAtBottom) {
      this.elems.main.scrollTop = this.elems.main.scrollHeight;
    } 
  }

}

const app = new Application();
