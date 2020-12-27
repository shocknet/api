
//

const { loggers } = require("winston")

/**
 * @typedef {object} Props
 * @prop {string} name
 * @prop {string} id
 * @prop {string?} version
 * @prop {string?} author
 * @prop {string?} authorPub 
 * @prop {string?} avatar 
 */

  /**
   * @typedef {object} BotCommandParamDef
   * @prop {string} paramName
   * @prop {boolean} isNumber
   * 
   * @typedef {object} BotCommandDef
   * @prop {string} command
   * @prop {string} commandName
   * @prop {string} commandDescription
   * @prop {(BotCommandParamDef|null)} param
   * 
   * @typedef {object} BotEventParamDef
   * @prop {string} paramName
   * @prop {boolean} isNumber
   * 
   * @typedef {object} BotEventDef
   * @prop {string} event
   * @prop {string} eventName
   * @prop {string} eventDescription
   * @prop {(BotEventParamDef|null)} param
   * 
   * @typedef {object} BotEvent
   * @prop {string} event
   * @prop {string|null} param
   * 
   * @typedef {object} BotCommand
   * @prop {string} command
   * @prop {string|null} param
   */

/**
 * Dont use this class directly, extend it instead
 * @class ChatBotBase
 */
class ChatBotBase {
  /**
   * @param {Props} props 
   */
  constructor(props){
    this.name = props.name
    this.id = props.id
    this.version = props.version || '0.0.0'
    this.author = props.author || 'Shocknet'
    this.authorPub = props.authorPub || ''
    this.avatar = props.avatar || null
  }

    /**
   * @type {Record<string,BotCommandDef>}
   */
  _availableCommands = {
    '/help':{
      command:'/help',
      commandName:'help',
      commandDescription:'list available commands',
      param:null
    }
  }

  get availableCommands(){
    return this._availableCommands
  }

  /**
   * 
   * @param {BotCommandDef[]} commands 
   */
  addCommands(commands){
    commands.forEach(element => {
      this._availableCommands[element.command] = element
    });
  }

  /**
   * @type {Record<string,BotEventDef}
   */
  _availableEvents = {}

  get availableEvents(){
    return this._availableEvents
  }

  /**
   * 
   * @param {BotEventDef[]} events 
   */
  addEvents(events){
    events.forEach(element => {
      this._availableEvents[element.event] = element
    });
  }

  _connected = false

  _connecting = false

  get connected(){
    return this._connected
  }

  get connecting(){
    return this._connecting
  }

  /**
   * @type {((id:string, text:string)=>void | null)}
   */
  _sendMessageToManager = null

  getWelcomeMessage(){
    return `Hello! my name is ${this.name} I'm a bot!`
  }
  
  /**
   * 
   * @typedef {object} ResponseAwait
   * @prop {'confirm'|'param-num'|'param-str'|null} responseType
   * @prop {string} responseMessageFooter
   * @prop {()=>void | null} responseCallback
   */

  /**
    * @type {ResponseAwait}
    */
  _awaitingResponse = {
    responseType:null,
    responseCallback:null,
    responseMessageFooter:''
  }

  /**
   * 
   * @param {(id:string, text:string)=>void} messageEmitter 
   */
  async Connect(messageEmitter){
    if(this._sendMessageToManager !== messageEmitter){
      this._sendMessageToManager = messageEmitter
    }
    //get ready make the connections that you need
    if(this._connected || this._connecting){
      return
    }
    this._connecting = true

    
    await this.onConnect()
    this._connected = true
  }

  FireEvent(event,param = null){
    if(this._availableEvents[event]){
      this.onEvent({
        event,
        param
      })
    }
  }

  /**
   * 
   * @param {BotEvent} event 
   */
  onEvent(event){ // eslint-disable-line class-methods-use-this
  }
  

  /**
   * 
   * @param {string} message 
   * @returns {(null|BotCommand|{message:string})}
   */
  parseMessage(message){
    if(!message.startsWith('/')){
      return null
    }
    const words = message.split(' ')
    //only allow one param for simplicity
    const [command,param] = words
    const commandDef = this._availableCommands[command]
    if(!commandDef){
      return {message:'unknown command'}
    }
    const paramDef = commandDef.param
    if(param && paramDef){
      if(commandDef.params[0].isNumber && isNaN(param)){
        return {message:'expected number as parameter'}
      }

      return {
        command,
        param

      }
    }
    return {
      command,
      param:null
    }

  }

  async onConnect(){ // eslint-disable-line class-methods-use-this
    //fire a 'ready' event
  }

  /**
   * 
   * @param {string} message 
   */
  onMessage(message){
    if(this._awaitingResponse.responseType){
      switch (this._awaitingResponse.responseType) {
        case 'confirm':{
            const lowerRes = message.toLowerCase()
            const yes = lowerRes === 'yes' || lowerRes === 'y'
            const no = lowerRes === 'no' || lowerRes === 'n'
            if(yes || no){
              this.handleAwaitedConfirm(yes)
              return
            }
            break
          }
        case 'param-str':{
          this.handleAwaitedParamSrt(message)
          return
        }
        case 'param-num':{
          if(isNaN(message)){
            break
          }
          this.handleAwaitedParamNum(message)
          return
        }
        default:
          break;
      }
      this.SendMessage(`I didn't understand`)
      return
    }
    //this.#saveMessage('user',message)
    const parsed = this.parseMessage(message)
    if(parsed && parsed.message){//error
      //this.SendMessage(parsed.message)
      return 
    }

    if(parsed && parsed.command){
      if(parsed.command === '/help'){
        const helpMessage = this.handleHelp()
        this.SendMessage(helpMessage)
        return
      }
      this.onCommand(parsed)
    }
  }

  /**
   * 
   * @param {BotCommand} command  
   */
  onCommand(command){ // eslint-disable-line class-methods-use-this
    //new command from user
  }

  /**
   * @param {string} message 
   * @param {{
   *  noTimeout:boolean,
   *  callback: (()=>void|null),
   *  callbackType: 'confirm'|'param-num'|'param-str'|null,
   *  responseMessageFooter: string,
   * }} opts
   */
  SendMessage(message,opts = {}){
    const {noTimeout = false, callback = null, callbackType = null,responseMessageFooter = ''} = opts
    if(!this._sendMessageToManager){
      return
    }
    if(this._awaitingResponse.responseType && callbackType){
      return
    }
    if(callbackType){
      this._awaitingResponse.responseType = callbackType
      this._awaitingResponse.responseCallback = callback
      this._awaitingResponse.responseMessageFooter = responseMessageFooter
      if(this._awaitingResponse.responseType === 'confirm'){
        this._awaitingResponse.responseMessageFooter = 'Please Confirm by responding (yes) or (y) or Cancel with (no) or (n)'
      }
    }
    const finalMessage = `${message} \n ${this._awaitingResponse.responseMessageFooter}` 
    if(noTimeout){
      this._sendMessageToManager(this.id,finalMessage)
    } else {
      setTimeout(()=>this._sendMessageToManager(this.id,finalMessage),250) //timeout to prevent the response to be written before the request
    }
  }

  //SendNotification(){
    //send notification to user
  //}
  /**
   * @returns {string}
   */
  handleHelp(){
    let helpMessage = 'Available Commands: \n'
    for (const key in this._availableCommands) {
      if (Object.hasOwnProperty.call(this._availableCommands, key)) {
        const element = this._availableCommands[key];
        helpMessage += element.command + " : " + element.commandName + " , " + element.commandDescription + "\n"
      }
    }
    helpMessage += 'Available Events: \n'
    for (const key in this._availableEvents) {
      if (Object.hasOwnProperty.call(this._availableEvents, key)) {
        const element = this._availableEvents[key];
        helpMessage += element.event + " : " + element.eventName + " , " + element.eventDescription + "\n"
        
      }
    }
    return helpMessage
  }

  /**
   * 
   * @param {boolean} didConfirm 
   */
  handleAwaitedConfirm(didConfirm){
    const {responseCallback:cb} = this._awaitingResponse
    this._awaitingResponse.responseType = null
    this._awaitingResponse.responseMessageFooter = ''
    this._awaitingResponse.responseCallback = null

    if(didConfirm){
      cb()
    }
  }

  /**
   * 
   * @param {string} param 
   */
  handleAwaitedParamSrt(param){
    const {responseCallback:cb} = this._awaitingResponse
    this._awaitingResponse.responseType = null
    this._awaitingResponse.responseMessageFooter = ''
    this._awaitingResponse.responseCallback = null
    cb(param)
  }

  /**
   * 
   * @param {number} param 
   */
  handleAwaitedParamNum(param){
    const {responseCallback:cb} = this._awaitingResponse
    this._awaitingResponse.responseType = null
    this._awaitingResponse.responseMessageFooter = ''
    this._awaitingResponse.responseCallback = null
    cb(param)
  }
}

module.exports = ChatBotBase