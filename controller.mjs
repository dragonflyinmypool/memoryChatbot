import dotenv from "dotenv";
import chokidar from "chokidar";
import { promises as fs } from "fs";
import path from "path";

dotenv.config();

const __dirname = new URL(".", import.meta.url).pathname;
const prompts = await readJsonFile(
  path.join(__dirname, "prompts/prompts.json")
);

// Monitor
async function monitorFolder(folderPath) {
  try {
    await fs.access(folderPath);
    console.log("Folder accessed");
  } catch (error) {
    console.error(
      `The folder "${folderPath}" does not exist or is not accessible.`
    );
    return;
  }

  chokidar
    .watch(path.join(__dirname, "notes"), {
      persistent: true,
      ignoreInitial: true,
      ignored: (filePath, stats) =>
        stats?.isFile() && !filePath.endsWith(".txt"),
      depth: 0,
    })
    .on("add", async (filePath) => {
      console.log(`File added or changed: ${filePath}`);
      try {
        const fileContent = await readTextFile(filePath);
        await addNote(fileContent, filePath);
        await updateState(fileContent);
      } catch (error) {
        console.error("Error processing new/updated file:", error);
      }
    });
}
// Read / Write to file
async function readTextFile(relativePath) {
  const filePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(__dirname, relativePath);
  const data = await fs.readFile(filePath, "utf8");
  return data;
}
async function appendtoTextFile(logEntry, logFilePath) {
  try {
    await fs.appendFile(logFilePath, logEntry);
    console.log(`Successfully appended to file: ${logFilePath}`);
  } catch (error) {
    console.error("Error appending to file:", error);
  }
}
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (
      error.code === "ENOENT" ||
      error.message.includes("Unexpected end of JSON input")
    ) {
      return [];
    }
    console.error("Error reading JSON file:", error);
    throw error;
  }
}
async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Successfully wrote to JSON file: ${filePath}`);
  } catch (error) {
    console.error("Error writing to JSON file:", error);
  }
}
async function updateJsonFileAtPath(filePath, pathToUpdate, newValue) {
  try {
    const jsonData = await readJsonFile(filePath);

    // Split the path string into individual keys
    const keys = pathToUpdate.split(".");
    let currentObject = jsonData;

    // Traverse the JSON object to find the target property
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      currentObject = currentObject[key];
    }

    // Update the target property with the new value
    currentObject[keys[keys.length - 1]] = newValue;

    await writeJsonFile(filePath, jsonData);
    console.log(`Successfully updated JSON file at path: ${pathToUpdate}`);
  } catch (error) {
    console.error("Error updating JSON file:", error);
  }
}

// Call API
async function callChatGPT(userMessage) {
  const payload = {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.7,
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error from OpenAI API:", errorData);
      throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return (
      data.choices?.[0]?.message?.content || "No content returned by the API."
    );
  } catch (error) {
    console.error("Request failed:", error);
    throw error;
  }
}
async function callGPTUpdateState(noteContent, stateFileContent) {
  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content:
          prompts.update +
          "Here is the note: " +
          noteContent +
          " Here is the state: " +
          stateFileContent,
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" },
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return { shouldUpdate: false, changes: null, updatedText: null };
  }

  const jsonObject = JSON.parse(content);
  return {
    shouldUpdate: jsonObject.shouldUpdate || false,
    changes: jsonObject.changes || null,
    updatedText: jsonObject.updatedText || null,
  };
}

// General flow
async function addNote(fileContent, filePath) {
  try {
    console.log(prompts.summarize, fileContent);
    const summary = await callChatGPT(prompts.summarize + fileContent);

    const currentDate = new Date()
      .toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour12: true,
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
      .replace(", ", " ");
    console.log(filePath, currentDate);

    const fileName = path.basename(filePath);
    const logFilePath = path.join(__dirname, "memory", "log.json");

    const log = await readJsonFile(logFilePath);
    log.push({ date: currentDate, fileName: fileName, summary: summary });
    await writeJsonFile(logFilePath, log);

    console.log("Summary: ", summary);
  } catch (error) {
    console.error("Error getting summary:", error);
  }
}
async function updateState(noteContent) {
  const stateFilePath = path.join(__dirname, "memory", "state.json");
  const stateFileContent = await readTextFile(stateFilePath);

  const response = await callGPTUpdateState(noteContent, stateFileContent);

  if (response.shouldUpdate) {
    console.log("Update path: ", response.path);
    console.log("New value: ", response.value);

    // Call the function to update the JSON file at the specified path
    await updateJsonFileAtPath(stateFilePath, response.path, response.value);
  }
}

// Initialise
monitorFolder(path.join(__dirname, "notes"));
