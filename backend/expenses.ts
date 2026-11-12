/**
 * Roomie Expenses Module
 * Provides functions to manage expenses in PostgreSQL.
 * All error messages are logged to the console.
 */

export interface HouseExpense {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  createdAt: Date;
  paid: boolean;
  conversationId: string;
}

export interface RoommateExpense {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  createdAt: Date;
  paid: boolean;
  roommateId: string;
}

/**
 * GET /houseexpenses
 * Returns a list of all expenses in the database.
 * @returns {Promise<HouseExpense[]>} A promise that resolves to an array of HouseExpense objects.
 */

/**
 * GET /roommateexpense/:roommateId
 * Returns a list of all expenses for a specific roommate.
 * @param {string} roommateId - The ID of the roommate.
 * @returns {Promise<RoommateExpense[]>} A promise that resolves to an array of RoommateExpense objects.
 */

/**
 * POST /houseexpenses
 * Creates a new expense in the database.
 * When created, the expense creates a RoommateExpense for each roommate in the conversation.
 * @param {HouseExpense} expense - The expense object to create.
 * @returns {Promise<HouseExpense>} A promise that resolves to the created HouseExpense object.
 */

/**
 * PUT /houseexpenses/:id
 * Updates an existing expense in the database.
 * @param {string} id - The ID of the expense to update.
 * @param {Partial<HouseExpense>} expense - The updated expense data.
 * @returns {Promise<HouseExpense>} A promise that resolves to the updated HouseExpense object.
 */

/**
 * PATCH /houseexpenses/:id
 * Updates the paid status of an existing expense in the database when all RoommateExpenses for that expense are paid.
 * @param {string} id - The ID of the expense to update.
 * @param {boolean} paid - The new paid status of the expense.
 * @returns {Promise<HouseExpense>} A promise that resolves to the updated HouseExpense object.
 */

/**
 * PATCH /roommateexpense/:id
 * Updates the paid status of an existing roommate expense in the database.
 * @param {string} id - The ID of the roommate expense to update.
 * @param {boolean} paid - The new paid status of the roommate expense.
 * @returns {Promise<RoommateExpense>} A promise that resolves to the updated RoommateExpense object.
 */

/**
 * DELETE /houseexpenses/:id
 * Deletes an existing expense from the database and all associated roommate expenses.
 * @param {string} id - The ID of the expense to delete.
 * @returns {Promise<void>} A promise that resolves when the expense is deleted.
 */
