import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  getDocs,
  setDoc,
  doc
} from "firebase/firestore";
import axios from "axios";
import Web3 from "web3";
import express from "express";
import NFTABI from "./NFTABI.json";
import { base64decode } from "nodejs-base64";

const FIREBASE_API_KEY = process.env.FIREBASE_KEY;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_KEY;
const COVALENT_API_KEY = process.env.COVALENT_KEY;
const TWITTER_API_KEY = process.env.TWITTER_KEY;
const PROVIDER = process.env.PROVIDER;

const firebaseConfig = {
  apiKey: FIREBASE_API_KEY,
  authDomain: "ranking-26d1c.firebaseapp.com",
  projectId: "ranking-26d1c",
  storageBucket: "ranking-26d1c.appspot.com",
  messagingSenderId: "495357706372",
  appId: "1:495357706372:web:e5e47ec4726944f9e7c2d1",
  measurementId: "G-LRT1TTL1CB"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore();

const app = express();

const Web3Client = new Web3(new Web3.providers.HttpProvider(PROVIDER));

let massiveUsers = [];

const getTxs = async (walletAddress) => {
  console.log("Getting transactions...");
  return axios
    .get(
      `https://api.etherscan.io/api?module=account&action=tokennfttx&address=${walletAddress}&page=1&offset=10000&startblock=0&endblock=27025780&sort=asc&apikey=${ETHERSCAN_API_KEY}`
    )
    .then((transactions) => {
      let temp = [];
      if (transactions.status >= 200 && transactions.status < 400) {
        transactions.data.result.map((each) => {
          if (each.to.toUpperCase() === walletAddress.toUpperCase())
            temp.push(each);
        });
        return temp;
      } else {
        return transactions.data.message;
      }
    });
};

const interactContract = (ABI, contract) => {
  //maybe retry or fetch contract with api if failed
  try {
    return new Web3Client.eth.Contract(ABI, contract);
  } catch {
    return "";
  }
};

const checkURIForImage = (res) => {
  if (!res) return "Invalid Contract";
  return res.data.image
    ? !res.data.image.slice(0, 7).includes("htt")
      ? "https://ipfs.io/ipfs/" + res.data.image.slice(7)
      : res.data.image
    : res.data.image_url
    ? "https://ipfs.io/ipfs/" + res.data.image.slice(7)
    : "Invalid URI";
};

const getImage = async (uri) => {
  if (uri.includes("base64")) {
    uri = uri.split(",");
    const decodedJson = JSON.parse(base64decode(uri[1]));
    const codedImage = decodedJson.image.split(",");
    try {
      const decodedImage = base64decode(codedImage[1]);
      return decodedImage;
    } catch {
      return codedImage;
    }
  }

  const image = await axios
    .get(uri)
    .then((data) =>
      data.data.image
        ? data.data.image
        : data.data.image_url
        ? data.data.image_url
        : uri
    )
    .catch(async (e) => {
      const CID = uri.slice(7);
      console.log("Requesting... https://ipfs.io/ipfs/" + CID);
      return await axios
        .get("https://ipfs.io/ipfs/" + CID)
        .then((res) => {
          return checkURIForImage(res);
        })
        .catch((e) => "Invalid URI");
    });
  return image;
};

const getUri = async (tx, contract) => {
  //maybe check here if contract call failed
  const uri = await contract.methods
    .tokenURI(tx.tokenID)
    .call()
    .catch((e) => "");
  return uri;
};

const getNFTuri = async (tx) => {
  const contract = interactContract(NFTABI, tx.contractAddress);
  console.log("Getting contract...", tx.contractAddress);
  if (tx.tokenSymbol !== "ENS") {
    if (contract && tx.tokenID) {
      const uri = await getUri(tx, contract);
      console.log("Setting URI...", uri);
      tx.uri = uri;
      console.log("Getting image...");
      const image = await getImage(uri);
      console.log("Setting image...", image);
      tx.image = image;
      return tx;
    }
  } else if (tx.tokenSymbol === "ENS") {
    tx.logo = "https://avatars.githubusercontent.com/u/34167658?s=200&v=4";
    return tx;
  }
};

const getValue = async (tx) => {
  console.log("Getting value...");
  //misisng check if value === "Max rate reached" etherscan API
  let value = await axios
    .get(
      `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${tx.hash}&apikey=${ETHERSCAN_API_KEY}`
    )
    .then((value) => {
      if (value && value.status >= 200 && value.status < 400) {
        tx.value = value.data.result;
        return tx;
      } else {
        tx.value = {};
        tx.value.value = "0x0";
        return tx;
      }
    })
    .catch((e) => {
      tx.value = {};
      console.log("Value failed");
      tx.value.value = "0x0";
      return tx;
    });
  console.log("Setting value...", tx.value.value);
  console.log("Setting full tx...", tx.hash, "\n");
  return tx;
};

const getTxList = (walletAddress) => getTxs(walletAddress);

const getUpdatedArr = async (arr) => {
  for (let i = 0, l = arr.length; i < l; i++) {
    console.log(arr[i].to);
    const uri = await getNFTuri(arr[i]);
    const value = await getValue(arr[i]);
  }
  return arr;
};

const getUriValue = async (txList) => {
  let returnObj = {};
  let tempL = txList.slice(0, 50);
  let returnArr = await getUpdatedArr(tempL);
  returnObj.NFTs = await returnArr;
  const totalValue = returnArr
    .map((nft) =>
      //patched it not final solution, have to check on API call
      nft.value.value ? parseInt(nft.value.value, 16) : "0x0"
    )
    .reduce((a, v) => a + v);
  returnObj.totalValue = totalValue;
  const time = new Date();
  returnObj.updatedAt = time;
  return returnObj;
};

const getCoinInfo = async (hash) => {
  try {
    const info = await axios.get(
      `https://api.coingecko.com/api/v3/coins/ethereum/contract/${hash}`
    );
    return info.data.image.small;
  } catch {
    return "No Info";
  }
};

const getTokensInfo = async (tokens) => {
  for (let i = 0, l = tokens.tokens.length; i < l; i++) {
    if (tokens.tokens[i].contract_name === "Ether") {
      tokens.tokens[i].logo_url =
        "https://assets.coingecko.com/coins/images/279/small/ethereum.png?1595348880";
    } else {
      const coinInfo = await getCoinInfo(tokens.tokens[i].contract_address);
      tokens.tokens[i].logo_url = coinInfo;
    }
  }
  return tokens;
};

const getTokens = async (user) => {
  let tokens = {};
  const txs = await axios.get(
    `https://api.covalenthq.com/v1/1/address/${user.address}/balances_v2/?key=${COVALENT_API_KEY}`
  );
  if (txs.status >= 200 && txs.status < 400) {
    tokens.tokens = txs.data.data.items;
    tokens.totalValue = tokens.tokens
      .map((token) => {
        if (token.quote && token.quote_24h) {
          token.gained = ((token.quote - token.quote_24h) / token.quote) * 100;
        }
        return token.quote.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).length > 20
          ? 0
          : token.quote;
      })
      .reduce((a, v) => a + v);
    tokens.totalGained =
      tokens.tokens
        .map((token) => (token.gained ? token.gained : 0))
        .reduce((a, b) => a + b) /
      tokens.tokens.filter((t) => t.balance !== "0").length;
    tokens.updatedAt = txs.data.data.updated_at;
    return tokens;
  } else {
    return;
  }
};

const writeExtensionDB = async (obj, id) => {
  const write = await setDoc(doc(db, "extensions", id), obj);
  return write;
};

const arrangeTxs = async (user, iter) => {
  if (user.NFTs?.length <= 0) return;
  iter++;
  let obj = {};
  const arr = user.NFTs.splice(0, 50);
  obj.NFTs = await getUriValue(arr);
  obj.address = user.address;
  obj.id = user.id;
  obj.docID = obj.id + Array(iter).fill("#").join("");
  console.log(obj);
  const written = await writeExtensionDB(obj, obj.docID);
  console.log("Extension added to DB");
  console.log(user.NFTs.length);
  const date = new Date();
  console.log(date);
  const awaitReturn = await arrangeTxs(user, iter);
  return awaitReturn;
};

const getExtensions = async () => {
  let extensions = [];
  const q = query(collection(db, "extensions"));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    const ext = doc.data();
    ext.id = doc.data().id;
    extensions.push(ext);
  });
  return extensions;
};

const filterExtensions = async () => {
  let temp = {};
  const extensions = await getExtensions();
  extensions.map((extension) =>
    !temp[extension.address]
      ? (temp[extension.address] = [extension])
      : temp[extension.address].push(extension)
  );
  Object.keys(temp)
    .map((ext) => temp[ext])
    .map((ext) => {
      ext.totalLength = ext
        .map((e) => e.NFTs.NFTs.length)
        .reduce((a, b) => a + b);
      ext.totalValue = ext
        .map((e) => (isNaN(e.NFTs.totalValue) ? 0 : e.NFTs.totalValue))
        .reduce((a, b) => a + b);
    });
  return temp;
};

const updateUsers = async (users) => {
  const filteredExtensions = await filterExtensions();
  for (let i = 0, l = users.length; i < l; i++) {
    const txs = await getTxList(users[i].address);
    if (
      txs.length >= 50 &&
      !massiveUsers.map((user) => user.id).includes(users[i].id)
    )
      massiveUsers.push({
        id: users[i].id,
        address: users[i].address,
        NFTs: !Object.keys(filteredExtensions).includes(users[i].address)
          ? txs.slice(50)
          : txs.slice(filteredExtensions[users[i].address].totalLength),
        extensions: users[i].extensions ? users[i].extensions : null
      });
    if (!users[i].NFTs?.quantity || users[i].NFTs.quantity !== txs.length) {
      const NFTs = await getUriValue(txs, users[i]);
      users[i].NFTs = NFTs;
      users[i].NFTs.quantity = txs.length;
      console.log(`${users[i].address} : NFTs done`);
    }
    const tokens = await getTokens(users[i]);
    const tkInfo = await getTokensInfo(tokens);
    console.log(`${users[i].address} : tokens done`);
    users[i].tokens = tkInfo;
    if (filteredExtensions[users[i].address]) {
      users[i].extensions = filteredExtensions[users[i].address].length;
      users[i].extensionsValue =
        filteredExtensions[users[i].address].totalValue;
    }
    await writeDB([users[i]]);
    console.log(users[i].address, "Was updated");
  }
  return users;
};

const getUsers = async () => {
  let addresses = [];
  const q = query(collection(db, "users"));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    const user = doc.data();
    user.id = doc.id;
    addresses.push(user);
  });
  return addresses;
};

const writeDB = (updatedAddresses) => {
  console.log(updatedAddresses);
  const writeAddresses = updatedAddresses.map(async (user) => {
    return await setDoc(doc(db, "users", user.id), user);
  });
  return Promise.all(writeAddresses).then((writeAddresses) => writeAddresses);
};

const runScript = async () => {
  let temp = {};
  await getUsers()
    .then((addresses) => updateUsers(addresses))
    .catch((e) => console.error(e));
  const extensions = await getExtensions();
  extensions.map((extension) =>
    !temp[extension.id] ? (temp[extension.id] = 1) : (temp[extension.id] += 1)
  );

  console.log(temp);
  for (let i = 0, l = massiveUsers.length; i < l; i++) {
    let iter = temp[massiveUsers[i].id] ? temp[massiveUsers[i].id] : 0;
    const extension = await arrangeTxs(massiveUsers[i], iter);
    return extension;
  }
  //maybe re-run if idle?
};

app.get("/", async (req, res) => {
  const run = await runScript();
  const time = new Date();
  res.end(`DB UPDATED at ${time}`);
  return run;
});

const port = "8080";
app.listen(port, () =>
  console.log(
    `server is listening at https://rpuss7.sse.codesandbox.io:${port}/...`
  )
);
