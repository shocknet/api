const lightningServices = require("./lightningServices")

/**
 * @typedef {(
 * 'invoice/created' |
 * 'invoice/paid' |
 * 'transaction/sent/unconfirmed' |
 * 'transaction/sent/confirmed' |
 * 'transaction/received/unconfirmed' |
 * 'transaction/received/confirmed' |
 * 'epoch/block'
 * )} LightningEvent
 */

class LoopSwaps {

  _connected = false 
  _connecting = false
  _swapClient = null
  _lightning = null
  _chainNotifier = null


  get connected(){
      return this._connected
  }
  get connecting(){
      return this._connecting
  }

  async Connect(){
    if(this._connected || this._connecting){
      return {message:'attempted to conned while already connected or connecting'}
    }
    this._connecting = true
    const {lightning,swapClient,chainNotifier} = lightningServices.services
    //small heath check
    
    const lndReady = await new Promise(resolve => {
      //get info never fails unless something is wrong or lnd is not ready yet
      lightning.getInfo({}, function(err, response) {
        if(response){
            resolve(true)
            return
        }
        if(err){
            resolve(false)
        }
      });
    })

    const loopReady = await new Promise(resolve => {
      //suggestSwaps never fails unless something is wrong or loopd is not ready yet
      swapClient.suggestSwaps({}, function(err, response) {
        if(response){
            resolve(true)
            return
        }
        if(err){
            resolve(false)
        }
      });
    })

    if(!lndReady){
      this._connecting = false
      return {message:'swap client init ABORT: LND not ready or not available'}
    }
    if(!loopReady){
      this._connecting = false
      return {message:'swap client init ABORT: LOOPD not ready or not available'}
    }

    //register the subs


    const  invoicesSub = lightning.subscribeInvoices({});
    call.on('data', function(response) {
      if(response.settled){
        this.FireEvent('invoice/paid')
      } else {
        this.FireEvent('invoice/created')
      }
    });
    call.on('status', function(status) {
    // The current status of the stream.
    });
    call.on('error', function(error) {
    // The current status of the stream.
    });
    call.on('end', function() {
    // The server has closed the stream.
    });

    const transactionsSub = lightning.subscribeTransactions({});
    call.on('data', function(response) {
      if(response.amount < 0) {
        if(response.num_confirmations === 0){
          this.FireEvent('transaction/sent/unconfirmed')
        } else {
          this.FireEvent('transaction/sent/confirmed')
        }
      } else {
        if(response.num_confirmations === 0){
          this.FireEvent('transaction/received/unconfirmed')
        } else {
          this.FireEvent('transaction/received/confirmed')
        }
      }
    });
    call.on('status', function(status) {
    // The current status of the stream.
    });
    call.on('error', function(error) {
    // The current status of the stream.
    });
    call.on('end', function() {
    // The server has closed the stream.
    });

    const epochSub = chainNotifier.registerBlockEpochNtfn(request);
    call.on('data', function(response) {
      this.FireEvent('epoch/block')
    });
    call.on('status', function(status) {
    // The current status of the stream.
    });
    call.on('error', function(error) {
    // The current status of the stream.
    });
    call.on('end', function() {
    // The server has closed the stream.
    });
  }

  /**
   * 
   * @param {LightningEvent} eventName 
   */
  FireEvent(eventName){
    switch (eventName) {
      case 'epoch/block':
      case 'invoice/created':
      case 'invoice/paid':
      case 'transaction/received/confirmed':
      case 'transaction/received/unconfirmed':
      case 'transaction/sent/confirmed':
      case 'transaction/sent/unconfirmed':
      default:
        //fire event from bot manager
    }
  }
}