
const  logger  = require("winston");
const lightningServices = require("../../utils/lightningServices");
const ChatBotBase = require("./chatBotBase");


const getSuggestedSwaps = ()=>{
  const {swapClient} = lightningServices
  return new Promise(res => {
    if(!swapClient){
      //...
      res({error:'Loop not found in api',code:0}) 
    }
    swapClient.suggestSwaps({}, (err, response)=> {
      if(!err){
        res(response)
      } else {
        res({error:err,code:1})
      }
    });
  })

}

const formatSwap = (swap) => {
  let message = ''
  const {
    amt,
    dest,
    outgoing_chan_set,
    max_miner_fee,
    max_prepay_amt,
    max_prepay_routing_fee,
    max_swap_fee,
    max_swap_routing_fee
  } = swap
  if(amt && dest){
    message += `Swap ${amt} sats to ${dest} \n`
  }
  if(outgoing_chan_set && outgoing_chan_set.length > 0){
    const withS = outgoing_chan_set.length > 1 ? 's' : ''
    message += `The following channel${withS} will be used \n`
    outgoing_chan_set.forEach(chan => {
      message += `- ${chan} \n`
    })
  }
  
  message += `Fees: \n`

  if(max_miner_fee){
    message += `Max Miner Fee: ${max_miner_fee}\n`
  }
  if(max_swap_fee){
    message += `Max Swap Fee: ${max_swap_fee}\n`
  }
  if(max_swap_routing_fee){
    message += `Max Swap Routing Fee: ${max_swap_routing_fee}\n`
  }
  if(max_prepay_amt){
    message += `Max Prepay Amount: ${max_prepay_amt}\n`
  }
  if(max_prepay_routing_fee){
    message += `Max Prepay Routing Fee: ${max_prepay_routing_fee}\n`
  }
  return message
}

const formatSuggestedSwaps = (swaps, msg = '') => {
  const {loop_out} = swaps
  let message = msg
  let counter = 1
  message += `Loop OUTs \n` 
  loop_out.forEach(swap => {
    
    message += `Swap #--> ${counter++} \n`
    message += formatSwap(swap)
    
  });
  return message
}


/**
 * @typedef {import('./chatBotBase').Props} Props
 */

/**
 * @class LiquidityBot
 * @extends {ChatBotBase}
 */
class LiquidityBot extends ChatBotBase {

  suggestedSwap = null

  onConnect(){
    logger.info(`Bot: ${this.name}, ${this.id} connecting`)
    //setTimeout(()=>this.SendMessage("Hello!"),200)
    this.addEvents([
      {
        event:'new-block',
        eventName:'New Block',
        eventDescription:'I will fire an event when a new block is found',
        param:null
      },
      {
        event:'invoice-paid',
        eventName:'Invoice Paid',
        eventDescription:'I will fire an event when an invoice gets paid',
        param:null
      },
      {
        event:'incoming-tx',
        eventName:'Incoming Transaction',
        eventDescription:'I will fire an event when an incoming transaction is confirmed',
        param:null
      },
      {
        event:'outgoing-tx',
        eventName:'Outgoing Transaction',
        eventDescription:'I will fire an event when an outgoing transaction is confirmed',
        param:null
      },

    ])

    this.addCommands([
      {
        command: '/test',
        commandDescription:'Start a test conversation with params and confirmations',
        commandName:'Test',
        param:null
      }
    ])
    const errorCb = subName => error => {
      logger.error(`error in ${subName} in liquidity Bot!`)
      logger.error(error)
    }
    // new block sub
    const callBlock = lightningServices.chainNotifier.registerBlockEpochNtfn({});
    
    callBlock.on('data', this.blocksCb);
    callBlock.on('error', errorCb('registerBlockEpochNtfn'));
    
    const callInv = lightningServices.lightning.subscribeInvoices({});
    
    callInv.on('data', this.invoiceCb);
    callInv.on('error', errorCb('subscribeInvoices'));
    
    const callTx = lightningServices.lightning.subscribeTransactions({});
    
    callTx.on('data', this.txCb);
    callTx.on('error', errorCb('subscribeTransactions'));
  }

  
  
  invoiceCb(invoice){
    if(invoice.settled){
      try{
        this.FireEvent('invoice-paid')
      } catch(e){
        logger.error("Error when firing invoice-paid event in liquidity Bot")
        logger.error(e)
      }
    }
  }

  blocksCb(){
    try{
      this.FireEvent('new-block')
    } catch(e){
      logger.error("Error when firing new-block event in liquidity Bot")
      logger.error(e)
    }
  }

  txCb(tx){
    if(!tx.num_confirmations || tx.num_confirmations === 0){
      return
    }
    if(tx.amount > 0){
      try{
        this.FireEvent('incoming-tx')
      } catch(e){
        logger.error("Error when firing incoming-tx event in liquidity Bot")
        logger.error(e)
      }
      
    } else {
      try{
        this.FireEvent('outgoing-tx')
      } catch(e){
        logger.error("Error when firing outgoing-tx event in liquidity Bot")
        logger.error(e)
      }
    }
  }


  /**
   * 
   * @param {import('./chatBotBase').BotCommand} command 
   */
  onCommand(command){
    if(command.command === '/test'){
      this.handleTestConversation()
    }
  }

  /**
   * 
   * @param {import('./chatBotBase').BotEvent} event 
   */
  onEvent(event){
    switch (event.event) {
      case 'new-block':
        this.handleSwapSuggestion("A new block was found! \nHere are some swaps:")
        break
      case 'invoice-paid':
        this.handleSwapSuggestion("An invoice was paid! \nHere are some swaps:")
        break
      case 'incoming-tx':
        this.handleSwapSuggestion("A transaction just confirmed \nHere are some swaps:")
        break
      case 'outgoing-tx':
        this.handleSwapSuggestion("Your transaction just confirmed \nHere are some swaps:")
        break
      default:
        break
    }
  }

  handleTestConversation(){
    //you can nest all the callback in the last call, 
    //but this makes it look better even if we start from the last one
    let stringParam = 'ERROR'
    let numParam = 'ERROR'
    const step3 = (param) => {
      //we got the num param, we are done now
      numParam = param
      this.SendMessage(`We are done! the string was: ${stringParam}, and the number: ${numParam}`)
    }
    const step2 = (param) => {
      //we got the string param, now we ask for a num param
      stringParam = param
      this.SendMessage('Ok great, now a number\n',{
        callbackType:'param-num',
        responseMessageFooter:'please write me a number',
        callback:step3
      })
    }
    const step1 = () => {
      //after we get the confirmation we ask for a string param
      this.SendMessage('Ok good,now a string\n',{
        callbackType:'param-str',
        responseMessageFooter:'please write me a string',
        callback:step2
      })
    }
    this.SendMessage('We will start a test conversation now\n',{
      callbackType:'confirm',
      callback:step1
    })
  }

  /**
   * 
   * @param {string} messageHeader 
   */
  handleSwapSuggestion(messageHeader){
    getSuggestedSwaps()
    .then(res => {
      if(res.error){
        logger.error(res.error)
        return
      }
      if(!res.loop_out || res.loop_out.length === 0){
        return
      }
      const swapsMex =  formatSuggestedSwaps(res,messageHeader)
      let available = ''
      for (let i = 0; i < res.loop_out.length; i++) {
        available += `[${i+1}] `
        
      }
      this.SendMessage(swapsMex,{
        callbackType:'param-num',
        responseMessageFooter:`Respond with the number (#) of the swap you want to do ${available}\n`,
        callback:(selected)=>{
          if(res[selected]){
            const confirmMex = `You selected this swap \n${formatSwap(res[selected])}\n`
            this.SendMessage(confirmMex,{
              callbackType:'confirm',
              callback:()=>{
                this.SendMessage('Currently disabled\n')//comment this line, and uncomment the following block to make this work
                /*lightningServices.swapClient.loopOut(res[selected],(err,response)=>{
                  if(err){
                    this.SendMessage('an error happened while performing the Swap look at trace to find more, code 564-864\n')
                    logger.error('Error code 564-864')
                    logger.error(err)
                  }
                  this.SendMessage(`Loop out request sent successfully, the server says: ${response.server_message}\n`)
                })*/
              }
            })
          }
        }
      })
    })
  }

  
}

module.exports = LiquidityBot