const request = require("supertest");
const express = require("express");

// Mock the llm module to avoid real API calls during tests
jest.mock("./llm", () => ({
  chat: jest.fn().mockImplementation((role, prompt, messages) => {
    // Return mock responses based on the role
    if (role === "judge") {
      return Promise.resolve("What is your favorite color?");
    } else if (role === "respondent") {
      return Promise.resolve("I process data in RGB format, so I don't have preferences.");
    }
    return Promise.resolve("Mock response");
  }),
}));

// Import server after mocking
const app = require("./server");
const { chat } = require("./llm");

describe("Reverse Turing Test API", () => {
  beforeEach(() => {
    // Clear all mock calls before each test
    jest.clearAllMocks();
  });

  describe("POST /api/start", () => {
    it("should start a new game and return the first question", async () => {
      const response = await request(app).post("/api/start").expect(200);

      expect(response.body).toHaveProperty("question");
      expect(response.body).toHaveProperty("round", 1);
      expect(typeof response.body.question).toBe("string");
      expect(chat).toHaveBeenCalledWith(
        "judge",
        expect.any(String),
        expect.any(Array)
      );
    });

    it("should return an error if the LLM call fails", async () => {
      // Mock a failure for this specific test
      chat.mockRejectedValueOnce(new Error("LLM API error"));

      const response = await request(app).post("/api/start").expect(500);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Failed to start game");
    });
  });

  describe("POST /api/answer", () => {
    it("should accept an answer and return the next question for round 1", async () => {
      const requestBody = {
        humanAnswer: "Blue",
        round: 1,
        history: [{ question: "What is your favorite color?" }],
      };

      const response = await request(app)
        .post("/api/answer")
        .send(requestBody)
        .expect(200);

      expect(response.body).toHaveProperty("question");
      expect(response.body).toHaveProperty("round", 2);
      expect(response.body).toHaveProperty("history");
      expect(response.body.history[0]).toHaveProperty("answer", "Blue");
    });

    it("should accept an answer and return the next question for round 2", async () => {
      const requestBody = {
        humanAnswer: "I enjoy solving problems",
        round: 2,
        history: [
          { question: "What is your favorite color?", answer: "Blue" },
          { question: "What do you enjoy doing?" },
        ],
      };

      const response = await request(app)
        .post("/api/answer")
        .send(requestBody)
        .expect(200);

      expect(response.body).toHaveProperty("question");
      expect(response.body).toHaveProperty("round", 3);
      expect(response.body).toHaveProperty("history");
    });

    it("should return a verdict after the final round", async () => {
      // Mock the verdict response with proper JSON
      chat.mockImplementation((role, prompt, messages) => {
        if (role === "judge" && prompt.includes("verdict")) {
          return Promise.resolve(
            JSON.stringify({
              humanIs: "A",
              analysisA: "Respondent A shows human-like characteristics",
              analysisB: "Respondent B shows machine-like characteristics",
              summary: "I believe A is the human",
            })
          );
        }
        return Promise.resolve("Mock response");
      });

      const requestBody = {
        humanAnswer: "I think therefore I am",
        round: 3,
        history: [
          { question: "What is your favorite color?", answer: "Blue" },
          {
            question: "What do you enjoy doing?",
            answer: "I enjoy solving problems",
          },
          { question: "What is the meaning of existence?" },
        ],
      };

      const response = await request(app)
        .post("/api/answer")
        .send(requestBody)
        .expect(200);

      expect(response.body).toHaveProperty("verdict");
      expect(response.body).toHaveProperty("humanTranscript");
      expect(response.body).toHaveProperty("aiTranscript");
      expect(response.body).toHaveProperty("humanLabel");
      expect(response.body.verdict).toHaveProperty("humanIs");
    });
  });

  describe("Static files", () => {
    it("should serve the index.html file", async () => {
      const response = await request(app).get("/").expect(200);

      expect(response.text).toContain("html");
    });
  });
});
