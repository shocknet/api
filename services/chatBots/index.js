
const Common = require('shock-common')
const logger = require('winston')
const ChatBotBase = require('./chatBotBase')
const LiquidityBotClass = require('./liquidityBot')
const GunDB = require('../gunDB/Mediator')
const GunEvents = require('../gunDB/contact-api/events')
const GunActions = require('../gunDB/contact-api/actions')
/**
 * @type {Record<string,ChatBotBase>}
 */
const ActiveChatBots = {}

//the 'id' must be unique and start with 'bot-'
const liquidityBot = new LiquidityBotClass({
  name:'Liquidity BOT',
  id:'bot-liquidity-000000000000002'
})

ActiveChatBots[liquidityBot.id] = liquidityBot

const handleBotMessage = (id,message) => {
  const botDestination = ActiveChatBots[id]
  if(!botDestination){
    return false
  }

  botDestination.onMessage(message)
  return true
}

const sendBotMessage = (id,message) => {
  const botSource = ActiveChatBots[id]
  if(!botSource){
    return
  }

  GunActions.writeBotMessage(id,message,false,GunDB.getUser(),GunDB.mySEA)
}

class MessagesManager {
  constructor(){
    this.onChatsUpdate = this.onChatsUpdate.bind(this)
  }
  
  _connected = false

  _connecting = false

  get _connected(){
    return this._connected
  }
  
  get _connecting(){
    return this._connecting
  }

  /**
   * @type {Common.Schema.Chat[]}
   */
  _gunChatHistory = []
  
  /**
   * @type {Common.Schema.Chat[]}
   */
  _botsChatHistory = []
  
  /**
   * @type {(chats:Common.Schema.Chat[])=>void}
   */
  _sendChatHistory = null

  _checkedEmptyChats = false

  ConnectBots(emitProcessedChats){
    if(this._sendChatHistory !== emitProcessedChats){
      this._sendChatHistory = emitProcessedChats
    }
    if(this._connecting || this._connected){
      return
    }
    this._connecting = true
    GunEvents.onChatBotsChats(this.onChatsUpdate,GunDB.getUser(),GunDB.mySEA)
    for (const botID in ActiveChatBots) {
      if (Object.hasOwnProperty.call(ActiveChatBots, botID)) {
        const selectedBot = ActiveChatBots[botID];
        logger.info(`registering Connect timer for ${botID} bot`)
        //every two seconds, try to connect the bot
        //useful to automatically retry if some critical services are not ready
        //Connect can be called multiple times after a successful connection with no consequences
        setInterval(()=>{
          selectedBot.Connect(sendBotMessage)
        },2000) 
        
      }
    }
    this._connected = true
  }

  /**
   * 
   * @param {GunEvents.ProcessedChats} botsChats 
   */
  onChatsUpdate(botsChats){
    if (!this._checkedEmptyChats) {
      this._checkedEmptyChats = true
      for (const activeBotID in ActiveChatBots) {
        if (Object.hasOwnProperty.call(ActiveChatBots, activeBotID)) {
          const element = ActiveChatBots[activeBotID];
          if (!botsChats || !botsChats[activeBotID]) {
            const welcomeMessage = element.getWelcomeMessage()
            sendBotMessage(activeBotID, welcomeMessage)
          }
        }
      }
    }

    if (!botsChats) {
      return
    }
    /**
     * @type {Common.Schema.Chat[]}
     */
    const filteredChatsArray = Object.entries(botsChats).filter(([chatId]) => !!ActiveChatBots[chatId])
    /**@type {Common.Schema.Chat[]}*/
    const ChatsArray = filteredChatsArray.map(([chatId,chat])=>{
      const chatBot = ActiveChatBots[chatId]
      /**@type {Common.Schema.ChatMessage[]}*/
      const messages = Object.entries(chat.messages).map(([messageId,message])=>({
        id:messageId,
        body:message.body,
        outgoing:message.outgoing,
        timestamp:message.timestamp
      }))
      return {
        didDisconnect:false,
        lastSeenApp:null,
        recipientAvatar:null,//chatBot.avatar,
        recipientDisplayName:chatBot.name,
        recipientPublicKey:chatBot.id,
        id:chatBot.id,
        messages
      }
    })
    try{
    this._botsChatHistory = ChatsArray || []
    this._sendChatHistory([...this._gunChatHistory,...this._botsChatHistory])
    } catch(e){
      logger.error('An error occurred while sending chat history after chat update')
      logger.error(e)
    }
  }

  /**
   * @param {Common.Schema.Chat[]} processedGunChats
   * @returns {Common.Schema.Chat[]}
   */
  joinGunChats(processedGunChats){
    this._gunChatHistory = processedGunChats
    return [...this._gunChatHistory,...this._botsChatHistory]
  }

  

  

}


const messagesManager = new MessagesManager()

module.exports = {
  messagesManager,
  ActiveChatBots,
  handleBotMessage
}
