import axios, { AxiosResponse } from 'axios'
import BigNumber from 'bignumber.js'
import Encryption from './Encryption'

export default function JupiterClient(opts: IJupiterClientOpts) {
  const encryption = Encryption({
    secret: opts.encryptSecret || opts.passphrase,
  })
  const CONF = {
    feeNQT: opts.feeNQT || 150,
    deadline: opts.deadline || 60,
    minimumFndrAccountBalance: opts.minimumFndrAccountBalance || 50000,
    minimumUserAccountBalance: opts.minimumUserAccountBalance || 100000,
    jupNqtDecimals: opts.jupNqtDecimals || 8,
  }

  return {
    recordKey: '__jupiter-password-manager',

    config: CONF,

    client: axios.create({
      baseURL: opts.server,
      headers: {
        'User-Agent': 'jupiter-password-manager',
      },
    }),

    // balances from the API come back as NQT, which is 1e-8 JUP
    nqtToJup(nqt: string): string {
      return new BigNumber(nqt).div(CONF.jupNqtDecimals).toString()
    },

    jupToNqt(jup: string): string {
      return new BigNumber(jup).times(CONF.jupNqtDecimals).toString()
    },

    decrypt: encryption.decrypt.bind(encryption),
    encrypt: encryption.encrypt.bind(encryption),

    async getBalance(address: string = opts.address): Promise<string> {
      const {
        data: {
          // unconfirmedBalanceNQT,
          // forgedBalanceNQT,
          balanceNQT,
          // requestProcessingTime
        },
      } = await this.request('get', '/nxt', {
        params: {
          requestType: 'getBalance',
          account: address,
        },
      })
      return this.nqtToJup(balanceNQT)
    },

    async createNewAddress(passphrase: string) {
      const {
        data: { accountRS: address, publicKey, requestProcessingTime, account },
      } = await this.request('post', '/nxt', {
        params: {
          requestType: 'getAccountId',
          secretPhrase: passphrase,
        },
      })
      return { address, publicKey, requestProcessingTime, account }
    },

    async sendMoney(recipientAddr: string) {
      const { data } = await this.request('post', '/nxt', {
        params: {
          requestType: 'sendMoney',
          secretPhrase: opts.passphrase,
          recipient: recipientAddr,
          amountNQT: CONF.minimumFndrAccountBalance,
          feeNQT: CONF.feeNQT,
          deadline: CONF.deadline,
        },
      })
      if (
        data.signatureHash === null ||
        (data.errorCode && data.errorCode !== 0)
      ) {
        throw new Error(JSON.stringify(data))
      }
      return data
    },

    // async parseEncryptedRecord(cipherText: string): Promise<IFndrAccount> {
    async parseEncryptedRecord(cipherText: string): Promise<any> {
      return JSON.parse(await this.decrypt(cipherText))
    },

    // async storeRecord(record: IStringMap) {
    async storeRecord(record: any) {
      const { data } = await this.request('post', '/nxt', {
        params: {
          requestType: 'sendMessage',
          secretPhrase: opts.passphrase,
          recipient: opts.address,
          recipientPublicKey: opts.publicKey,
          messageToEncrypt: await this.encrypt(
            JSON.stringify({
              ...record,
              [this.recordKey]: true,
            })
          ),
          feeNQT: CONF.feeNQT,
          deadline: CONF.deadline,
          compressMessageToEncrypt: true,
        },
      })
      if (data.errorCode && data.errorCode !== 0)
        throw new Error(JSON.stringify(data))
      return data
    },

    async decryptRecord(
      message: ITransactionAttachmentDecryptedMessage
    ): Promise<string> {
      const {
        data: { decryptedMessage },
      } = await this.request('get', '/nxt', {
        params: {
          requestType: 'decryptFrom',
          secretPhrase: opts.passphrase,
          account: opts.address,
          data: message.data,
          nonce: message.nonce,
        },
      })
      return decryptedMessage
    },

    async getAllTransactions(
      withMessage: boolean = true,
      type: number = 1
    ): Promise<ITransaction[]> {
      const [confirmed, unconfirmed] = await Promise.all([
        await this.getAllConfirmedTransactions(withMessage, type),
        await this.getAllUnconfirmedTransactions(withMessage, type),
      ])
      return unconfirmed.concat(confirmed)
    },

    async getAllConfirmedTransactions(
      withMessage: boolean = true,
      type: number = 1
    ): Promise<ITransaction[]> {
      const {
        data: {
          /* requestProcessingTime, */
          transactions,
        },
      } = await this.request('get', '/nxt', {
        params: {
          requestType: 'getBlockchainTransactions',
          account: opts.address,
          withMessage,
          type,
        },
      })
      return transactions == null ? [] : transactions
    },

    async getAllUnconfirmedTransactions(
      withMessage: boolean = true,
      type: number = 1
    ): Promise<ITransaction[]> {
      const {
        data: {
          /* requestProcessingTime, */
          unconfirmedTransactions,
        },
      } = await this.request('post', '/nxt', {
        params: {
          requestType: 'getUnconfirmedTransactions',
          account: opts.address,
          withMessage,
          type,
        },
      })

      return unconfirmedTransactions == null
        ? []
        : unconfirmedTransactions.reverse()
    },

    async request(
      verb: 'get' | 'post',
      path: string,
      opts?: IRequestOpts
    ): Promise<AxiosResponse> {
      switch (verb) {
        case 'post':
          return await this.client.post(
            path,
            undefined, // opts && opts.body
            {
              params: opts && opts.params,
            }
          )

        default:
          // get
          return await this.client.get(path, opts)
      }
    },
  }
}

interface IJupiterClientOpts {
  server: string
  address: string
  passphrase: string
  encryptSecret?: string
  publicKey?: string
  feeNQT?: number
  deadline?: number
  minimumFndrAccountBalance?: number
  minimumUserAccountBalance?: number
  jupNqtDecimals?: number
}

interface IRequestOpts {
  // TODO: according to the NXT docs the only way to pass parameters is
  // via query string params, even if it's a POST. This seems bad, but for
  // now since POST body isn't support don't allow it in a request.
  params?: any
  // body?: any
}

interface ITransactionAttachment {
  [key: string]: any
}

interface ITransactionAttachmentDecryptedMessage {
  data: string
  nonce: string
  isText: boolean
  isCompressed: boolean
}

interface ITransaction {
  signature: string
  transactionIndex: number
  type: number
  phased: boolean
  ecBlockId: string
  signatureHash: string
  attachment: ITransactionAttachment
  senderRS: string
  subtype: number
  amountNQT: string
  recipientRS: string
  block: string
  blockTimestamp: number
  deadline: number
  timestamp: number
  height: number
  senderPublicKey: string
  feeNQT: string
  confirmations: number
  fullHash: string
  version: number
  sender: string
  recipient: string
  ecBlockHeight: number
  transaction: string
}
